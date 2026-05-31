# Flyer Ingest Bot

## SLACK APP SETUP (steps to do before deploying)

1. Go to https://api.slack.com/apps → Create New App → From Scratch
   Name: "Flyer Ingest Bot"
   Workspace: Farewell & Howdy workspace

2. OAuth & Permissions → Bot Token Scopes → Add:
     files:read
     channels:history
     groups:history
     chat:write         (to post confirmation thread replies)

3. Install to Workspace → copy the Bot User OAuth Token (xoxb-...) →
   store as SLACK_BOT_TOKEN secret in Cloudflare

4. Basic Information → App Credentials → copy Signing Secret →
   store as SLACK_SIGNING_SECRET secret in Cloudflare

5. Deploy the Worker first (wrangler deploy) to get the .workers.dev URL.

6. Event Subscriptions → Enable Events → Request URL:
     https://flyer-eater.farewellcafe.com
   (The Worker handles url_verification automatically via app.run())

7. Subscribe to bot events → Add Bot User Events:
     message.channels
     message.groups
   → Save Changes → Reinstall App when prompted

8. In the Farewell & Howdy Slack workspace, go to #flyers channel,
   type @Flyer Ingest Bot → invite it when prompted.
   Repeat for any private #bot-testing channel.
