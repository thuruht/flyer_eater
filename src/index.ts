import {
  SlackApp,
  isPostedMessageEvent
} from 'slack-cloudflare-workers';
import type { Env, StagedEvent, FarwhyEvent } from './types';
import { detectVenue, parseEmbargoTimestamp } from './slack';
import { uploadFlyerToR2 } from './storage';
import { buildEvent, insertEvent } from './db';

export default {
  // ── Fetch handler: Slack webhook receiver ─────────────────────────
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const app = new SlackApp({ env })
      .event('message', async ({ payload, context }) => {
        // ── DELETION BRANCH ───────────────────────────────────────────
        if ((payload as any).subtype === 'message_deleted') {
          const deletedTs = (payload as any).previous_message?.ts;
          if (deletedTs) {
            const { getEventBySlackTs, deleteEvent } = await import('./db');
            const existingEvent = await getEventBySlackTs(env, deletedTs);
            if (existingEvent) {
              // Backup to KV
              await env.STAGING_KV.put(`deleted_backup_${deletedTs}`, JSON.stringify(existingEvent));
              // Delete from D1
              await deleteEvent(env, existingEvent.id);
              
              await context.client.chat.postMessage({
                channel: payload.channel,
                text: `🗑️ Flyer message deleted. The event *${existingEvent.title}* has been removed from the website.\n\n_To restore it, reply "release" to this thread or the original one (if it exists)._`
              });
            }
          }
          return;
        }

        // Reject non-post events (edits, etc. handled by SlackApp defaults or above)
        if (!isPostedMessageEvent(payload)) return;

        // ── REPLY COMMANDS & CORRECTIONS BRANCH ───────────────────────
        if ((payload as any).thread_ts && (payload as any).thread_ts !== payload.ts) {
          const threadTs = (payload as any).thread_ts;
          const text = (payload.text ?? '').trim().toLowerCase();
          const { getEventBySlackTs, updateEvent, insertEvent } = await import('./db');

          // Command: release
          if (text === 'release') {
            const backedUp = await env.STAGING_KV.get(`deleted_backup_${threadTs}`);
            if (backedUp) {
              const event = JSON.parse(backedUp);
              await insertEvent(env, event);
              await env.STAGING_KV.delete(`deleted_backup_${threadTs}`);
              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `✅ Event *${event.title}* has been released and published back to the website!`
              });
              return;
            }
          }

          // Command: delete
          if (text === 'delete') {
            const backedUp = await env.STAGING_KV.get(`deleted_backup_${threadTs}`);
            if (backedUp) {
              await env.STAGING_KV.delete(`deleted_backup_${threadTs}`);
              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `🔥 Event backup deleted permanently.`
              });
              return;
            }
          }

          // Fallback: AI Correction
          const { parseCorrections } = await import('./ocr');
          const existingEvent = await getEventBySlackTs(env, threadTs);
          if (existingEvent) {
            const corrections = await parseCorrections(env.AI, payload.text ?? '', existingEvent);
            if (Object.keys(corrections).length > 0) {
              await updateEvent(env, existingEvent.id, corrections);
              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `✅ Event updated with your corrections! Updated fields: ${Object.keys(corrections).join(', ')}`
              });
              return;
            }
          }
        }
        // ──────────────────────────────────────────────────────────────

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

        const { parseCaption } = await import('./caption_parser');
        const captionData = parseCaption(caption);
        console.log('[flyer-eater] Caption extracted:', JSON.stringify(captionData));

        const { transcribeFlyer, parseTranscription } = await import('./ocr');
        const { getCalendarText, storeCalendarText, parseCalendarFilename } = await import('./calendar');
        const { validateEventsAgainstCalendars } = await import('./validation');

        // BATCH PROCESS ALL IMAGES
        for (const file of imageFiles) {
          try {
            // 1. Download the private Slack file
            const dlResp = await fetch(
              file.url_private_download ?? file.url_private,
              { headers: { Authorization: `Bearer ${context.botToken}` } }
            );
            if (!dlResp.ok) {
              console.error(`[flyer-eater] Failed to download file ${file.name}:`, dlResp.status);
              continue;
            }
            const imageBuffer = await dlResp.arrayBuffer();

            // ── CALENDAR INGESTION BRANCH ──────────────────────────────
            const isCalendar = file.name?.toLowerCase().includes('bw_cal') || caption.toLowerCase().includes('calendar');
            if (isCalendar) {
              const ocrText = await transcribeFlyer(env.AI, imageBuffer);
              let venueKey: 'farewell' | 'howdy' = venueFromCaption ?? 'farewell';
              let year = new Date().getFullYear();
              let month = new Date().getMonth() + 1;

              // Try to get metadata from filename
              if (file.name) {
                try {
                  const meta = parseCalendarFilename(file.name);
                  venueKey = meta.venue;
                  year = meta.year;
                  month = meta.month;
                } catch { /* fallback to defaults */ }
              }

              await storeCalendarText(env, venueKey, year, month, ocrText);
              
              // IMMEDIATE VALIDATION
              const correctionsCount = await validateEventsAgainstCalendars(env, venueKey, year, month);
              const correctionsMsg = correctionsCount > 0 
                ? `\n🔄 Automatically corrected ${correctionsCount} existing events based on this calendar.`
                : '';

              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `📅 Official calendar for *${venueKey}* (${year}-${month}) has been ingested and will be used as the primary source of truth.${correctionsMsg}`
              });
              continue;
            }
            // ──────────────────────────────────────────────────────────

            // ── FLYER PROCESSING BRANCH ────────────────────────────────
            // 2. Upload image to R2 immediately
            const { r2Key, imageUrl } = await uploadFlyerToR2(
              env,
              imageBuffer,
              file.mimetype ?? 'image/jpeg',
              file.name ?? 'flyer.jpg'
            );

            // 3. Run vision AI step 1 (Transcription)
            const ocrText = await transcribeFlyer(env.AI, imageBuffer);
            console.log('[flyer-eater] OCR text:', ocrText);

            // 3.5 Get calendar data if available
            // Use candidate date from caption or current date
            const candidateDate = captionData.date ?? new Date().toISOString().split('T')[0];
            const [cYear, cMonth] = candidateDate.split('-').map(Number);
            
            // Note: 'venue' might be overridden by VLM later, but we use caption/default for lookup
            const lookupVenue = venueFromCaption ?? 'farewell';
            const calendarText = await getCalendarText(env, lookupVenue, cYear, cMonth);
            if (calendarText) {
              console.log(`[flyer-eater] Found calendar truth for ${lookupVenue} ${cYear}-${cMonth}`);
            }

            // 4. Run text LLM step 2 (Structured extraction)
            const vlmData = await parseTranscription(env.AI, ocrText, caption, venueFromCaption, calendarText);
            console.log('[flyer-eater] VLM extracted:', JSON.stringify(vlmData));

            // 5. Resolve final venue
            const finalVenue: 'farewell' | 'howdy' =
              venueFromCaption
              ?? (vlmData.venue_hint === 'howdy' ? 'howdy' : 'farewell');

            // 6. Merge caption and VLM data
            const { event, warnings } = buildEvent(captionData, vlmData, finalVenue, imageUrl);
            console.log('[flyer-eater] Final event:', JSON.stringify(event));

            // 7. Embargo check
            const announceAfter = embargoTs
              ?? (vlmData.announce_after ? Math.floor(new Date(vlmData.announce_after).getTime() / 1000) : null);

            const statusIcon = warnings.length > 0 ? '⚠️' : '✅';
            const warningMsg = warnings.length > 0 ? `\n_Warning: ${warnings.join(', ')}_` : '';

            if (announceAfter && announceAfter > now) {
              // Stage in KV — cron will publish it later
              const staged: StagedEvent = {
                eventData: { ...event, slack_ts: payload.ts } as FarwhyEvent,
                r2Key,
                slackTs: payload.ts,
                announceAfter
              };
              await env.STAGING_KV.put(
                `embargo_${payload.ts}`,
                JSON.stringify(staged),
                { expirationTtl: Math.max(announceAfter - now + 86400, 86400) } 
              );
              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `${statusIcon} Flyer received and staged. Will publish to farewellcafe.com after <!date^${announceAfter}^{date_short_pretty} at {time}|${new Date(announceAfter * 1000).toISOString()}>.${warningMsg}\n\n_Tip: Reply to this thread with any corrections (e.g. "date is Jan 16") to update the event!_`
              });

            } else {
              // Publish immediately
              const eventWithTs = { ...event, slack_ts: payload.ts };
              const newId = await insertEvent(env, eventWithTs as FarwhyEvent);
              await context.client.chat.postMessage({
                channel: payload.channel,
                thread_ts: payload.ts,
                text: `${statusIcon} *${event.title}* added to farewellcafe.com\nVenue: ${event.venue} | Date: ${event.date} | Price: ${event.price ?? 'TBD'}\nID: \`${newId}\`${warningMsg}\n\n_Tip: Reply to this thread with any corrections (e.g. "date is actually Jan 16") to update the event!_`
              });
            }
          } catch (err) {
            console.error(`[flyer-eater] Error processing file ${file.name}:`, err);
          }
        }
      });

    // app.run() handles: url_verification challenge, signing secret
    // verification, event routing — no manual boilerplate needed
    return await app.run(request, ctx);
  },

  // ── Scheduled handler: publish embargoed events & validate DB ──────
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

    // Retrospective validation against calendars
    const { validateEventsAgainstCalendars } = await import('./validation');
    const corrections = await validateEventsAgainstCalendars(env);
    if (corrections > 0) {
      console.log(`[cron] Validated events: ${corrections} corrections applied.`);
    }
  }
};
