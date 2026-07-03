# Posting Flyers to the Website — Quick Guide

Post your flyer image in `#flyers` and the bot handles the rest. This is a
cheat sheet for getting a clean listing on the first try, plus how to fix
things after the fact.

## The basics

1. Upload the flyer image to `#flyers`.
2. Add a caption with at least the **date** and **venue**. Everything else
   (lineup, price, time) the bot will try to read off the flyer itself.
3. Within a few seconds you'll get a ✅ reply confirming what was posted —
   title, venue, date, price, and an event ID.

If you see a ⚠️ instead of ✅, read the warning in the reply — it usually
means a field couldn't be determined and got a placeholder (e.g. title
defaulted to "TBA"). Fix it with a thread reply (see **Corrections** below).

## Caption tips

The caption is the one thing a human typed, so it's trusted for **date and
venue** — use it to correct a misprinted flyer or clarify Farewell vs. Howdy.
For lineup/price/title, the bot reads the flyer image itself and only falls
back to the caption if the flyer scan comes up empty, so don't worry about
retyping the full lineup — a short caption is fine.

Good captions:
- `7/23 - Howdy - VELVET, Granule, Dreamist`
- `Aug 2 at Farewell, $10`
- `repost - hardcore matinee @ howdy - $5` (labels like "repost", "update",
  "v2", "pt 2" are recognized and ignored, not treated as a band name)

If the flyer says PWYC with a dollar amount or range (e.g. "$10-15 PWYC"),
the dollar figure is always kept in the listing — it's more useful than the
PWYC label alone.

Supported date formats: `7/23`, `07.23.26`, `2026-07-23`, `July 23`,
`23rd of July`, `this Saturday`, `tomorrow`.

## Scheduling a hold (embargo)

Add a phrase like `hold until Jan 15` or `do not announce until Jan 15` to
the caption. The event is staged privately and only appears on the website
after that date/time — a cron job publishes it automatically. You'll still
get a confirmation reply, but it'll say "staged" instead of "added."

## Fixing mistakes (corrections)

Reply **in the flyer's thread** with a plain-English correction:

- `date is actually July 24`
- `it's at howdy`
- `price is $12`
- `hold until Aug 1`

The bot parses your reply and updates just that field — no need to repost
the flyer. Works whether the event is already live or still on hold.

## Deleting a flyer

Delete the original Slack message and the bot removes the event from the
website automatically, backing it up first. If you want it back:

- Reply `release` in the deletion notice thread → restores the event.
- Reply `delete` in the deletion notice thread → permanently discards the
  backup.

## Posting an official calendar (staff)

If you're posting the venue's official monthly calendar image (not an
individual flyer), make sure the filename contains `bw_cal` or the caption
mentions "calendar." The bot treats it as ground truth and will
auto-correct any already-posted events for that month that don't match.

## Troubleshooting

| You see | What it means |
|---|---|
| ⚠️ "Title defaulted to TBA" | Neither the flyer scan nor the caption had a clear title/lineup — reply with a correction. |
| ⚠️ "Date defaulted to today" | No date was found anywhere — reply with `date is <actual date>`. |
| Price shows "TBD" | The flyer scan didn't catch a price at all — reply with `price is $X`. |
| Bot didn't respond at all | Make sure an image is actually attached, not just linked/pasted as text. |
