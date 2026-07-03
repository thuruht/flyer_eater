# flyer-eater

Slack-to-website event ingest bot for [Farewell Cafe](https://farewellcafe.com) and
Howdy music venues in Kansas City. Listens for concert flyers posted in Slack,
extracts event details using AI and heuristics, and stores them in the shared
D1 `farewell-db` event database.

## How it works

1. Someone posts a flyer image in `#flyers` on Slack.
2. The caption is parsed heuristically for dates, prices, times, and performers.
3. The flyer image is OCR'd via Workers AI (vision model).
4. OCR text + caption + optional venue calendar are sent to a text LLM for
   structured extraction (title, date, venue, price, performers, etc.).
5. The flyer image (via the vision/text LLM pipeline) takes priority for title,
   performers, price, tags, and description; caption fills in gaps there. The
   caption takes priority for date and venue, since staff use it to correct
   misprinted flyers. `applyAutoPopulationRules` covers anything still missing.
6. Events are published immediately or staged in KV if embargoed.
7. A cron job (`*/15 * * * *`) publishes matured embargoes and validates
   existing events from the last 30 days against stored venue calendars.
8. Users can reply to the bot's confirmation thread with corrections
   ("date is actually Jan 16") — AI parses and applies them.

## Operations

### Calendar ingestion

Official venue calendars can be posted as images. A message is treated as a
calendar if any attached image filename contains `bw_cal` **or** the caption
contains `calendar`. The image is OCR'd and stored in `STAGING_KV` under
`calendar_text_<venue>_<year>_<month>_<timestamp>`. Multiple calendar images for
the same month are kept and joined. Stored calendar text has a 60-day TTL.

After a calendar is ingested, the bot immediately validates existing events for
that venue/month against it and reports how many were corrected.

### Embargoes

A phrase like "do not announce until Jan 15" or "hold until Jan 15" in the
caption is stripped from extraction and used to stage the event in
`STAGING_KV` under `embargo_<slack_ts>`. The KV entry lives until
`announce_after + 1 day` and is published by the cron job once the embargo
expires. If a publish fails, the staged event is left in KV and retried on the
next cron run.

### Deletion, restore, and purge

- Deleting the original Slack flyer message removes the event from D1 and backs
  it up to `STAGING_KV` under `deleted_backup_<slack_ts>`.
- Replying `release` in the deletion notification thread restores the event to
  D1 and deletes the backup.
- Replying `delete` in the deletion notification thread permanently deletes
  the backup.

### Thread corrections

Replies to the bot's confirmation thread can update fields in the whitelist:
`title`, `date`, `venue`, `event_time`, `price`, `description`,
`age_restriction`, `performers`, `tags`. A correction that sets `announce_after`
to a future date moves a published event back into KV staging; a corrected
embargoed event is updated in place in KV.

### Image URLs

Flyers are stored in R2 with keys like `flyers/<timestamp>-<random>.<ext>` and
served at `/images/{r2Key}`.

## Commands

| Command | Action |
|---------|--------|
| `npm run dev` | `wrangler dev` — local dev server |
| `npm run build` | `tsc --noEmit` — typecheck only |
| `npm run deploy` | `wrangler deploy` — production deploy |
| `wrangler tail` | Inspect production logs |

No tests, linter, or formatter are configured.

## Bindings (wrangler.jsonc)

| Binding | Resource | Purpose |
|---------|----------|---------|
| `AI` | Workers AI | Vision OCR + text extraction |
| `DB` | D1 `farewell-db` | Event storage (SQLite) |
| `IMAGES` | R2 `fwhy-images` | Flyer image hosting |
| `STAGING_KV` | KV namespace | Embargo queue, calendar text cache, deletion backups |

## AI models

- **Vision (OCR)**: `@cf/meta/llama-3.2-11b-vision-instruct`
- **Text extraction**: `@cf/meta/llama-3.1-8b-instruct`

## Environment secrets

Set these via `wrangler secret put` (use `.dev.vars` **only** for local/dev
values, never production secrets):

| Secret | Description |
|--------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot user OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for request verification |

**Security note:** `.dev.vars` is gitignored. Do not commit it. If it has ever
contained production credentials, rotate those secrets.

## Slack app setup

1. Go to https://api.slack.com/apps → Create New App → From Scratch  
   Name: "Flyer Ingest Bot"  
   Workspace: Farewell & Howdy workspace

2. OAuth & Permissions → Bot Token Scopes → Add:
   - `files:read`
   - `channels:history`
   - `groups:history`
   - `chat:write`

3. Install to Workspace → copy the Bot User OAuth Token (`xoxb-...`) →
   store it securely as the `SLACK_BOT_TOKEN` secret via `wrangler secret put`.

4. Basic Information → App Credentials → copy Signing Secret →
   store it securely as the `SLACK_SIGNING_SECRET` secret via `wrangler secret put`.

5. Deploy the Worker first (`wrangler deploy`) to get the request URL.

6. Event Subscriptions → Enable Events → Request URL:  
   `https://flyer-eater.farewellcafe.com`  
   (The Worker handles `url_verification` automatically via `app.run()`)

7. Subscribe to bot events → Add Bot User Events:
   - `message.channels`
   - `message.groups`
   → Save Changes → Reinstall App when prompted

8. In the Farewell & Howdy Slack workspace, go to `#flyers`,
   type `@Flyer Ingest Bot` → invite it when prompted.  
   Repeat for any private channel the bot should monitor (e.g., `#bot-testing`).
