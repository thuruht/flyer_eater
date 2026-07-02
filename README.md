# flyer-eater

Slack-to-website event ingest bot for [Farewell Cafe](https://farewellcafe.com) and
Howdy music venues in Kansas City. Listens for concert flyers posted in Slack,
extracts event details using AI and heuristics, and publishes them to the venue's
event database.

## How it works

1. Someone posts a flyer image in `#flyers` on Slack.
2. The caption is parsed heuristically for dates, prices, times, performers.
3. The flyer image is OCR'd via Workers AI (vision model).
4. OCR text + caption + optional venue calendar are sent to a text LLM for
   structured extraction (title, date, venue, price, performers, etc.).
5. Caption data takes priority; VLM fills in gaps; defaults cover the rest.
6. Events are published immediately or staged in KV if embargoed.
7. A cron job (`*/15 * * * *`) publishes matured embargoes and validates
   existing events against stored venue calendars.
8. Users can reply to the bot's confirmation thread with corrections
   ("date is actually Jan 16") — AI parses and applies them.

## Commands

| Command | Action |
|---------|--------|
| `npm run dev` | `wrangler dev` — local dev server |
| `npm run build` | `tsc --noEmit` — typecheck only |
| `npm run deploy` | `wrangler deploy` — production deploy |

No tests, linter, or formatter are configured.

## Bindings (wrangler.jsonc)

| Binding | Resource | Purpose |
|---------|----------|---------|
| `AI` | Workers AI | Vision OCR + text extraction |
| `DB` | D1 `farewell-db` | Event storage (SQLite) |
| `IMAGES` | R2 `fwhy-images` | Flyer image hosting |
| `STAGING_KV` | KV namespace | Embargo queue, calendar text cache |

## AI models

- **Vision (OCR)**: `@cf/meta/llama-3.2-11b-vision-instruct`
- **Text extraction**: `@cf/meta/llama-3.1-8b-instruct`

## Environment secrets

Set these via `wrangler secret put` (or in `.dev.vars` for local dev):

| Secret | Description |
|--------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot user OAuth token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack app signing secret for request verification |

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
   store as `SLACK_BOT_TOKEN` secret.

4. Basic Information → App Credentials → copy Signing Secret →
   store as `SLACK_SIGNING_SECRET` secret.

5. Deploy the Worker first (`wrangler deploy`) to get the URL.

6. Event Subscriptions → Enable Events → Request URL:
   `https://flyer-eater.farewellcafe.com`
   (The Worker handles `url_verification` automatically via `app.run()`)

7. Subscribe to bot events → Add Bot User Events:
   - `message.channels`
   - `message.groups`
   → Save Changes → Reinstall App when prompted

8. In the Farewell & Howdy Slack workspace, go to `#flyers`,
   type `@Flyer Ingest Bot` → invite it when prompted.
   Repeat for any private `#bot-testing` channel.
