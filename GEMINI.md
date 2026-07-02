# GEMINI.md - Flyer Ingest Bot

## Project Overview

**Flyer Ingest Bot** (`flyer-eater`) is a Slack-to-website automation tool for
the Farewell Cafe and Howdy music venues in Kansas City. It listens for concert
flyers posted in Slack, extracts event details using AI and heuristics, and
stores them in the shared D1 `farewell-db` event database.

The project is built as a **Cloudflare Worker** and leverages the following services:

- **Workers AI**: Uses `@cf/meta/llama-3.2-11b-vision-instruct` for OCR and
  `@cf/meta/llama-3.1-8b-instruct` for structured data extraction and corrections.
- **R2 Storage**: Stores flyer images.
- **D1 Database**: Stores event metadata in a SQLite-compatible database.
- **KV Storage**: Stages embargoed events, stores deletion backups, and caches
  OCR'd venue calendars.
- **Cron Triggers**: Every 15 minutes publishes matured embargoes and runs
  retrospective calendar validation.

## Architecture & Logic Flow

1. **Slack Webhook (`src/index.ts`)**: Receives `message` events, including
   deletions and thread replies.
2. **Calendar Ingestion**: If an attached image filename contains `bw_cal`
   **or** the caption contains `calendar`, the image is OCR'd and stored in
   `STAGING_KV`. Multiple calendar images for the same venue/month are kept and
   joined.
3. **Data Extraction**:
   - **Caption Parsing (`src/caption_parser.ts`)**: Heuristic extraction from the
     Slack message.
   - **OCR (`src/ocr.ts`)**: Transcribes the flyer image.
   - **Calendar Correlation**: Fetches relevant calendar text from KV to include
     in the VLM prompt.
   - **AI Refinement (`src/ocr.ts`)**: Merges OCR text, caption context, and
     calendar data into structured JSON.
4. **Merging (`src/db.ts`)**: Final merge priority is
   **caption > VLM > performers-as-title > auto-population defaults**.
   Calendars inform the VLM prompt but do not override caption data in
   `buildEvent`.
5. **Publishing**: Events are inserted into D1 immediately unless an
   `announce_after` date stages them in KV.
6. **Deletion & Restore**: Deleting the original Slack message removes the D1
   event and backs it up to KV. Replying `release` or `delete` in the resulting
   thread restores or permanently deletes the backup.
7. **Interactive Corrections**: Replies to the bot's confirmation thread can
   update whitelisted fields. If a correction sets a future `announce_after`, a
   published event is moved from D1 back into KV staging.
8. **Scheduled Maintenance**: Every 15 minutes the cron handler publishes
   matured embargoes and validates events from the last 30 days (or a filtered
   venue/month) against stored calendars.

## Building and Running

### Development

```bash
# Run local development server
npm run dev

# Type check
npm run build
```

### Deployment

```bash
# Deploy to Cloudflare
npm run deploy
```

### Environment Secrets

Set in Cloudflare via `wrangler secret put`. Use `.dev.vars` **only** for
local/dev values, never production secrets.

- `SLACK_BOT_TOKEN`: OAuth bot token (`xoxb-...`)
- `SLACK_SIGNING_SECRET`: For verifying Slack requests

## Development Conventions

- **Type Safety**: `FarwhyEvent` mirrors the D1 schema and includes `slack_ts`
  for thread tracking.
- **Venue Normalization**: Venues are strictly `'farewell'` or `'howdy'`,
  detected by `detectVenue()` in `src/slack.ts` and finalized in `src/index.ts`.
- **Correctable Fields**: Thread replies and calendar validation may only touch
  `title`, `date`, `venue`, `event_time`, `price`, `description`,
  `age_restriction`, `performers`, `tags` (plus `announce_after` for staging
  logic).
- **Calendar Usage**: Official calendars are provided to the VLM as the highest
  source of truth in the prompt. The final `buildEvent` merge still respects
  caption > VLM > defaults.
- **Embargo & TTLs**: Embargo KV entries expire `announce_after + 1 day`;
  calendar KV entries expire after 60 days.
- **Deletion Backups**: Persist until explicitly `release`d or `delete`d.
- **Failure Handling**: Failed embargo publishes stay in KV for retry on the
  next cron run.
- **Interactive Editing**: Users can fix errors by replying directly to the bot
  in Slack.

## AI Models

- Vision: `@cf/meta/llama-3.2-11b-vision-instruct`
- Text: `@cf/meta/llama-3.1-8b-instruct`

## Key Files

- `src/index.ts`: Entry point; handles flyer/calendar detection, Slack replies,
  and cron.
- `src/calendar.ts`: Calendar KV read/write and filename parsing.
- `src/validation.ts`: Logic for retrospective DB validation.
- `src/ocr.ts`: AI pipeline for transcription, extraction, and reply
  corrections.
- `src/db.ts`: SQL generation, D1 interaction, and data merge logic.
- `src/caption_parser.ts`: Heuristic parser for Slack captions.
- `src/slack.ts`: Venue detection, embargo parsing, and embargo-text stripping.
- `src/storage.ts`: R2 flyer upload helpers.
- `wrangler.jsonc`: Cloudflare configuration and bindings.
- `src/bwcalimgs/`: Reference/sample calendar images (not used at runtime;
  `*.png` is gitignored).
