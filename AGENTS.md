# flyer-eater

Slack-to-website event ingest bot for Farewell Cafe & Howdy (KCMO). Cloudflare Workers project.

## Commands & Debugging

| Command | What it does |
|---------|-------------|
| `npm run dev` | `wrangler dev` local server (Requires `.dev.vars` for Slack secrets) |
| `npm run build` | `tsc --noEmit` typecheck only |
| `npm run deploy` | `wrangler deploy` to production |
| `wrangler tail` | Inspect production logs |

**Testing**: No test suite exists. Use `curl` to send mock Slack JSON payloads to the `wrangler dev` endpoint for manual verification.

## Architecture

- **Entrypoint**: `src/index.ts` — single Worker with fetch (Slack webhook) + scheduled (cron) handlers. Use `Env` from `./types.ts` for all handlers.
- **Bindings** (`wrangler.jsonc`): `AI` (Workers AI), `DB` (D1 `farewell-db`), `IMAGES` (R2 `fwhy-images`), `STAGING_KV`.
- **Cron**: `*/15 * * * *` — publishes embargoed events from KV, runs retrospective calendar validation.
- **AI Models**: 
  - Vision/OCR: `@cf/meta/llama-3.2-11b-vision-instruct`
  - Text Extraction/Refinement: `@cf/meta/llama-3.1-8b-instruct`

## Key quirks

- **Dynamic Imports**: Used in `src/index.ts` to defer loading (e.g., `const { x } = await import('./y');`). Follow this pattern for non-hot-path modules.
- **Venues**: strictly `'farewell'` or `'howdy'`. Detected by `detectVenue()` in `src/slack.ts` and finalized in `src/index.ts` (caption hint wins, then VLM `venue_hint`, then default `farewell`).
- **Data Merge Priority**: caption parser > VLM extraction > performers-as-title fallback > `applyAutoPopulationRules` defaults (`src/db.ts`). Calendars are provided to the VLM as high-trust context but do not override caption data in `buildEvent`.
- **Embargo Stripping**: Always use `removeEmbargoText()` (`src/slack.ts`) on user-provided caption text before extraction to prevent embargo phrases from leaking into data.
- **Calendar Ingestion**: Images with `bw_cal` in filename **or** `calendar` in caption are OCR'd and stored in KV as ground truth (`calendar_text_{venue}_{year}_{month}_{timestamp}`). Multiple images per venue/month are kept and joined. Calendar KV entries have a 60-day TTL.
- **Immediate Validation**: After a calendar is ingested, `validateEventsAgainstCalendars()` is run for that venue/month right away.
- **Retrospective Validation Window**: Cron validation only checks events from the last 30 days unless explicit `filterVenue`/`filterYear`/`filterMonth` arguments are passed (`src/validation.ts`).
- **Embargo Staging**: Embargoed events are stored under `embargo_{slack_ts}` with a TTL of `announce_after + 1 day`.
- **Embargo Retry**: If cron publication to D1 fails, the staged event stays in KV and is retried on the next cron run.
- **Deletion Workflow**: A `message_deleted` event removes the matching D1 event, backs it up to KV as `deleted_backup_{slack_ts}`, and notifies the channel. Reply `release` to restore it; reply `delete` to purge the backup permanently.
- **Thread Corrections**: Replies to the bot thread update `CORRECTABLE_FIELDS` (`src/db.ts`). If a correction sets a future `announce_after`, a published event is removed from D1 and re-staged in KV.
- **Correctable Field Whitelist**: Thread/calendar corrections may only touch `title`, `date`, `venue`, `event_time`, `price`, `description`, `age_restriction`, `performers`, `tags` (plus `announce_after` for staging logic).
- **Image URLs**: R2 flyers are uploaded to keys like `flyers/{timestamp}-{random}.{ext}` and exposed at `/images/{r2Key}` (`src/storage.ts`).
- **Slack Security**: Do not bypass or modify `slack-cloudflare-workers` logic; it handles critical signature verification and event routing.
- **Database**: All D1 schema changes **must** be implemented via `migrations/`. Do not run raw `schema.sql` (it contains stale test data).
- **Environment**: `.dev.vars` is used for local Slack secrets. It is gitignored; do not commit it. For local development, prefer separate dev Slack app credentials instead of the production `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET`. Rotate production secrets immediately if they are ever committed or shared.
- **Observability**: `console.log` is the primary mechanism for debugging in the Workers environment.

## Slack setup

README.md at repo root has step-by-step Slack app setup. The Worker must be deployed first to get the URL for Event Subscriptions.
