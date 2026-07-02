# Changelog

All notable changes to flyer-eater are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Embargo text leaking into performer/title/date extraction: "hold until Jan 15" was
  parsed as a band name and the embargo date was used as the event date. Added
  `removeEmbargoText()` to strip embargo phrases from the caption before it reaches
  the heuristic parser and VLM prompt.
- VLM prompt now explicitly instructs the model to treat embargo/announcement dates
  as `announce_after`, never as the event `date`.

## [1.0.0] — 2026-06-08

### Added

- Initial release. Slack-to-website event ingest bot for Farewell Cafe and Howdy
  venues in Kansas City.
- Slack webhook receiver (`message.channels`, `message.groups`) using
  `slack-cloudflare-workers`.
- Vision AI pipeline: OCR via `@cf/meta/llama-3.2-11b-vision-instruct`, structured
  extraction via `@cf/meta/llama-3.1-8b-instruct`.
- Heuristic caption parser for dates, prices, times, and performers.
- Calendar correlation: official venue calendars can be posted as images and stored
  in KV as ground truth for retrospective validation.
- Embargo support: "do not announce until <date>" stages events in KV with cron-based
  release (`*/15 * * * *`).
- Interactive corrections: replies to the bot's confirmation thread with natural
  language corrections are parsed by AI and merged into the event.
- R2 image storage, D1 event database, Slack deletion/release workflow.
- Custom domain route: `flyer-eater.farewellcafe.com`.
