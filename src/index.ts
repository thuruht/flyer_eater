import {
  SlackApp,
  isPostedMessageEvent
} from 'slack-cloudflare-workers';
import type { Env, StagedEvent } from './types';
import { detectVenue, parseEmbargoTimestamp } from './slack';
import { extractEventData } from './ocr';
import { uploadFlyerToR2 } from './storage';
import { buildEventFromVLM, insertEvent } from './db';

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

        // 3. Run vision AI with caption as context hint
        const extract = await extractEventData(
          env.AI, imageBuffer, caption, venueFromCaption
        );

        // 4. Resolve venue: caption text > VLM hint > default 'farewell'
        const venue: 'farewell' | 'howdy' =
          venueFromCaption
          ?? (extract.venue_hint === 'howdy' ? 'howdy' : 'farewell');

        // 5. Build the complete event object (applies auto-population rules)
        const event = buildEventFromVLM(extract, venue, imageUrl);

        // 6. Embargo check
        const announceAfter = embargoTs
          ?? (extract.announce_after ? Math.floor(new Date(extract.announce_after).getTime() / 1000) : null);

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
            text: `⏳ Flyer received and staged. Will publish to farewellcafe.com after <!date^${announceAfter}^{date_short_pretty} at {time}|${new Date(announceAfter * 1000).toISOString()}>.`
          });

        } else {
          // Publish immediately
          const newId = await insertEvent(env, event);
          await context.client.chat.postMessage({
            channel: payload.channel,
            thread_ts: payload.ts,
            text: `✅ *${event.title}* added to farewellcafe.com\nVenue: ${event.venue} | Date: ${event.date} | Price: ${event.price ?? 'TBD'}\nID: \`${newId}\``
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
