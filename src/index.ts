import {
  SlackApp,
  isPostedMessageEvent
} from 'slack-cloudflare-workers';
import type { Env, StagedEvent } from './types';
import { detectVenue, parseEmbargoTimestamp } from './slack';
import { uploadFlyerToR2 } from './storage';
import { buildEvent, insertEvent } from './db';

export default {
  // ── Fetch handler: Slack webhook receiver ─────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = new SlackApp({ env })
      .event('message', async ({ payload, context }) => {
        // Reject non-post events (edits, deletions, bot messages)
        if (!isPostedMessageEvent(payload)) return;

        // Only process messages that contain image file attachments
        const files = (payload as any).files ?? [];
        const imageFiles = files.filter(
          (f: any) => f.mimetype?.startsWith('image/')
        );
        if (imageFiles.length === 0) return;

        const caption = payload.text ?? '';
        const venueFromCaption = detectVenue(caption);
        const embargoTs = parseEmbargoTimestamp(caption);
        const now = Math.floor(Date.now() / 1000);

        // Process only the first image (one flyer = one show)
        const file = imageFiles[0];

        // 1. Download the private Slack file
        const dlResp = await fetch(
          file.url_private_download ?? file.url_private,
          { headers: { Authorization: `Bearer ${context.botToken}` } }
        );
        if (!dlResp.ok) {
          console.error('[flyer-eater] Failed to download file:', dlResp.status);
          return;
        }
        const imageBuffer = await dlResp.arrayBuffer();

        // 2. Upload image to R2 immediately (even if embargoed — we want
        //    the file stored; D1 row insertion is what gets delayed)
        const { r2Key, imageUrl } = await uploadFlyerToR2(
          env,
          imageBuffer,
          file.mimetype ?? 'image/jpeg',
          file.name ?? 'flyer.jpg'
        );

        // 3. Parse caption first
        const { parseCaption } = await import('./caption_parser');
        const captionData = parseCaption(caption);
        console.log('[flyer-eater] Caption extracted:', JSON.stringify(captionData));

        // 4. Run vision AI step 1 (Transcription)
        const { transcribeFlyer, parseTranscription } = await import('./ocr');
        const ocrText = await transcribeFlyer(env.AI, imageBuffer);
        console.log('[flyer-eater] OCR text:', ocrText);

        // 5. Run text LLM step 2 (Structured extraction)
        const vlmData = await parseTranscription(env.AI, ocrText, caption, venueFromCaption);
        console.log('[flyer-eater] VLM extracted:', JSON.stringify(vlmData));

        // 6. Resolve venue: caption text > VLM hint > default 'farewell'
        const venue: 'farewell' | 'howdy' =
          venueFromCaption
          ?? (vlmData.venue_hint === 'howdy' ? 'howdy' : 'farewell');

        // 7. Merge caption and VLM data
        const { event, warnings } = buildEvent(captionData, vlmData, venue, imageUrl);
        console.log('[flyer-eater] Final event:', JSON.stringify(event));

        // 8. Embargo check
        const announceAfter = embargoTs
          ?? (vlmData.announce_after ? Math.floor(new Date(vlmData.announce_after).getTime() / 1000) : null);

        const statusIcon = warnings.length > 0 ? '⚠️' : '✅';
        const warningMsg = warnings.length > 0 ? `\n_Warning: ${warnings.join(', ')}_` : '';

        if (announceAfter && announceAfter > now) {
          // Stage in KV — cron will publish it later
          const staged: StagedEvent = {
            eventData: event,
            r2Key,
            slackTs: payload.ts,
            announceAfter
          };
          await env.STAGING_KV.put(
            `embargo_${payload.ts}`,
            JSON.stringify(staged),
            { expirationTtl: announceAfter - now + 86400 }  // auto-expire 24h after release
          );
          await context.client.chat.postMessage({
            channel: payload.channel,
            thread_ts: payload.ts,
            text: `${statusIcon} Flyer received and staged. Will publish to farewellcafe.com after <!date^${announceAfter}^{date_short_pretty} at {time}|${new Date(announceAfter * 1000).toISOString()}>.${warningMsg}`
          });

        } else {
          // Publish immediately
          const newId = await insertEvent(env, event);
          await context.client.chat.postMessage({
            channel: payload.channel,
            thread_ts: payload.ts,
            text: `${statusIcon} *${event.title}* added to farewellcafe.com\nVenue: ${event.venue} | Date: ${event.date} | Price: ${event.price ?? 'TBD'}\nID: \`${newId}\`${warningMsg}`
          });
        }
      });

    // app.run() handles: url_verification challenge, signing secret
    // verification, event routing — no manual boilerplate needed
    return await app.run(request, ctx);
  },

  // ── Scheduled handler: publish embargoed events ────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    const now = Math.floor(Date.now() / 1000);
    const list = await env.STAGING_KV.list({ prefix: 'embargo_' });

    for (const key of list.keys) {
      const raw = await env.STAGING_KV.get(key.name);
      if (!raw) continue;

      let staged: StagedEvent;
      try {
        staged = JSON.parse(raw);
      } catch {
        console.error('[cron] Failed to parse staged event:', key.name);
        continue;
      }

      if (staged.announceAfter <= now) {
        try {
          await insertEvent(env, staged.eventData);
          await env.STAGING_KV.delete(key.name);
          console.log(`[cron] Published embargoed event: ${staged.eventData.id}`);
        } catch (err) {
          console.error(`[cron] Failed to publish ${key.name}:`, err);
          // Leave in KV — will retry next cron run
        }
      }
    }
  }
};
