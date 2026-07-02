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
- **Venues**: strictly `'farewell'` or `'howdy'`. Normalized in `src/db.ts:3`.
- **Data Merge Priority**: caption parser > VLM extraction > `applyAutoPopulationRules` defaults (`src/db.ts:42-73`).
- **Embargo Stripping**: Always use `removeEmbargoText()` (`src/slack.ts`) on user-provided caption text before extraction to prevent embargo phrases from leaking into data.
- **Calendar Ingestion**: Images with `bw_cal` in filename or `calendar` in caption are OCR'd and stored in KV as ground truth (`calendar_text_{venue}_{year}_{month}`). Note: 60-day TTL.
- **Slack Security**: Do not bypass or modify `slack-cloudflare-workers` logic; it handles critical signature verification and event routing.
- **Database**: All D1 schema changes **must** be implemented via `migrations/`. Do not run raw `schema.sql` (it contains stale test data).
- **Environment**: `.dev.vars` contains real production secrets (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET).
- **Observability**: `console.log` is the primary mechanism for debugging in the Workers environment.

## Slack setup

README.md at repo root has step-by-step Slack app setup. The Worker must be deployed first to get the URL for Event Subscriptions.
