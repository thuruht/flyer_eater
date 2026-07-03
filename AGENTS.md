# flyer-eater

Slack-to-website event ingest bot for Farewell Cafe & Howdy (KCMO). Cloudflare Workers project.

## Commands & Debugging

| Command | What it does |
|---------|-------------|
| `npm run dev` | `wrangler dev` local server (Requires `.dev.vars` for Slack secrets) |
| `npm run build` | `tsc --noEmit` typecheck only |
| `npm run deploy` | `wrangler deploy` to production |
| `wrangler tail` | Inspect production logs |
| `npm test` | `vitest run` — unit tests |

**Testing**: `npm test` covers `src/caption_parser.ts` and `src/db.ts` (16 tests). No coverage for `src/ocr.ts` (live AI binding) or `src/index.ts` (Slack webhook) — verify prompt/model changes against the live Workers AI endpoint before deploying, and use `curl` with mock Slack JSON payloads against `wrangler dev` for webhook changes.

## Architecture

- **Entrypoint**: `src/index.ts` — single Worker with fetch (Slack webhook) + scheduled (cron) handlers. Use `Env` from `./types.ts` for all handlers.
- **Bindings** (`wrangler.jsonc`): `AI` (Workers AI), `DB` (D1 `farewell-db`), `IMAGES` (R2 `fwhy-images`), `STAGING_KV`.
- **Cron**: `*/15 * * * *` — publishes embargoed events from KV, runs retrospective calendar validation.
- **AI Models**: 
  - Vision/OCR: `@cf/meta/llama-3.2-11b-vision-instruct`
  - Text Extraction/Refinement: `@cf/meta/llama-3.1-8b-instruct-fp8` (plain
    `-instruct` was deprecated 2026-05-30 and silently failed every call,
    caught only via Workers Observability logs — confirm a model is still
    listed in `wrangler ai models` before depending on it)

## Key quirks

- **Dynamic Imports**: Used in `src/index.ts` to defer loading (e.g., `const { x } = await import('./y');`). Follow this pattern for non-hot-path modules.
- **Venues**: strictly `'farewell'` or `'howdy'`. Detected by `detectVenue()` in `src/slack.ts` and finalized in `src/index.ts` (caption hint wins, then VLM `venue_hint`, then default `farewell`).
- **Data Merge Priority** (`buildEvent()` in `src/db.ts`): for `title`/`performers`/`price`/`tags`/`description`, **VLM > caption** > performers-as-title fallback > `applyAutoPopulationRules` defaults — the flyer image (VLM, with calendar context) is more informed than caption shorthand. For `date`/`venue`/`event_time`, **caption > VLM** — staff deliberately use the caption to correct a misprinted flyer or disambiguate venue. A plausibility guard also discards a lone, calendar-uncorroborated caption performer guess when VLM found a fuller lineup.
- **Price Extraction**: a dollar amount printed on the flyer must always survive into `price`, even with PWYC/sliding-scale — e.g. `"PWYC ($10-15)"`, never bare `"PWYC"`. Enforced in both the VLM prompt (`src/ocr.ts`) and `extractPrice()` (`src/caption_parser.ts`).
- **Version/Revision Noise**: `extractPerformers()` (`src/caption_parser.ts`) strips version/revision tokens (`v2`, `pt 2`, `repost`, `update`, etc.) before splitting on delimiters, so caption noise like "07.23.26 Howdy V2" never becomes a fake performer name.
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
- **Observability**: Workers Logs/observability is enabled (`wrangler.jsonc`, 100% head sampling) — `console.log`/`console.error` calls are persisted and queryable via the dashboard's Observability tab or `wrangler tail`, not just ephemeral. This is how the deprecated-model failure below was diagnosed.

## Slack setup

README.md at repo root has step-by-step Slack app setup. The Worker must be deployed first to get the URL for Event Subscriptions.
