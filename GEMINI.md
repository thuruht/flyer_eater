# GEMINI.md - Flyer Ingest Bot

## Project Overview
**Flyer Ingest Bot** (`flyer-eater`) is a Slack-to-website automation tool designed for the Farewell Cafe and Howdy music venues in Kansas City. It listens for concert flyers posted in Slack, extracts event details using AI and heuristics, and publishes them to the `farewellcafe.com` event database.

The project is built as a **Cloudflare Worker** and leverages the following services:
- **Workers AI**: Uses `@cf/meta/llama-3.2-11b-vision-instruct` for OCR and `@cf/meta/llama-3.1-8b-instruct` for structured data extraction.
- **R2 Storage**: Stores flyer images.
- **D1 Database**: Stores event metadata in a SQLite-compatible database.
- **KV Storage**: Stages "embargoed" events and stores OCR'd venue calendars as a source of truth.
- **Cron Triggers**: Periodically checks KV for maintenance tasks.

## Architecture & Logic Flow
1. **Slack Webhook (`src/index.ts`)**: Receives `message` events.
2. **Calendar Ingestion**: If an image filename contains `bw_cal`, the bot OCRs it and stores the text in `STAGING_KV` as the "Source of Truth" for that month and venue.
3. **Data Extraction**:
   - **Caption Parsing (`src/caption_parser.ts`)**: Heuristic extraction from the Slack message.
   - **OCR (`src/ocr.ts`)**: Transcribes the flyer image.
   - **Calendar Correlation**: Fetches relevant calendar text from KV.
   - **AI Refinement (`src/ocr.ts`)**: Merges all data into a structured JSON object.
4. **Interactive Corrections**: Users can reply to the bot's confirmation message with corrections (e.g., "the price is actually $5"). The bot parses these replies and updates the database.
5. **Scheduled Maintenance**: Every 15 minutes, the bot:
   - Publishes matured events from KV to D1.
   - Cross-references existing DB events against venue calendars to automatically fix discrepancies.
6. **Data Merging (`src/db.ts`)**: Applies final defaults and inserts/updates the database.

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
The following secrets must be set in Cloudflare:
- `SLACK_BOT_TOKEN`: OAuth token (xoxb-...)
- `SLACK_SIGNING_SECRET`: For verifying Slack requests.

## Development Conventions
- **Type Safety**: `FarwhyEvent` mirrors the D1 schema and includes `slack_ts` for thread tracking.
- **Venue Normalization**: Venues are strictly `'farewell'` or `'howdy'`.
- **Calendar Truth**: Official B&W calendars take precedence over flyer text.
- **Interactive Editing**: Users can fix errors by replying directly to the bot in Slack.
- **AI Models**:
  - Vision: `@cf/meta/llama-3.2-11b-vision-instruct`
  - Text: `@cf/meta/llama-3.1-8b-instruct`

## Key Files
- `src/index.ts`: Entry point; handles flyer/calendar detection and Slack replies.
- `src/calendar.ts`: Utilities for venue calendar data.
- `src/validation.ts`: Logic for retrospective DB validation.
- `src/ocr.ts`: AI pipeline for transcription, parsing, and reply corrections.
- `src/db.ts`: SQL generation and D1 interaction.
- `src/caption_parser.ts`: Heuristic parser for Slack captions.
- `wrangler.jsonc`: Cloudflare configuration and bindings.
- `src/bwcalimgs/`: Local storage for official venue calendars (should be posted to Slack for ingestion).
