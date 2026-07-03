# Changelog

All notable changes to flyer-eater are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Extraction trust hierarchy: caption text (e.g. a stray "V2" or "UPDATE")
  could override a correct, fuller lineup already read from the flyer by the
  VLM. `buildEvent()` now prefers VLM output for `title`/`performers`/`price`/
  `tags`/`description`; caption still wins for `date`/`venue`. Added a
  plausibility guard that discards an uncorroborated single-performer caption
  guess when the calendar doesn't back it up and the VLM found a fuller
  lineup.
- `extractPerformers()` now strips version/revision tokens (`v2`, `pt 2`,
  `repost`, `update(d)`, `redo`, etc.) before splitting on delimiters, so they
  never become fake performer names.
- Dollar amounts printed on a flyer no longer get discarded in favor of a bare
  "PWYC" — both the VLM prompt and `extractPrice()` now always preserve the
  figure (e.g. `"PWYC ($10-15)"`). Fixed a related latent bug where a price
  range outside 1-12 (e.g. `$20-25`) leaked its second number into the
  performers list.
- Migrated off `@cf/meta/llama-3.1-8b-instruct`, deprecated 2026-05-30. Every
  call had been silently failing and returning `{}`, causing recent posts to
  default to `title: TBA` / `price: TBD` and thread corrections to silently
  no-op. Diagnosed via newly-enabled Workers Observability logs; switched to
  `@cf/meta/llama-3.1-8b-instruct-fp8`.

### Added

- Workers Logs/observability enabled (`wrangler.jsonc`, 100% head sampling).
- vitest test suite for `src/caption_parser.ts` and `src/db.ts` (16 tests).
- `docs/PROMOTER_GUIDE.md` — plain-language guide for promoters/staff.

### Changed

- Upgraded wrangler 3.x → 4.107.0.

## [1.1.0] — 2026-07-02

### Added

- Calendar correlation and deletion workflow.
- Official venue calendar ingestion: images with `bw_cal` in the filename or
  `calendar` in the caption are OCR'd and stored in KV.
- Immediate validation of existing events against a newly ingested calendar.
- Retrospective calendar validation limited to events within the last 30 days
  (cron) or explicit `venue`/`year`/`month` filters.
- Thread corrections can now patch embargoed events in KV and move a published
  event back into KV staging when a future `announce_after` is set.
- Deletion backup/restore: deleting a Slack flyer message removes the event from
  D1 and backs it up to KV; `release` and `delete` thread commands restore or
  purge it.
- Title fallback chain: caption title → VLM title → joined performers → `TBA`.

### Fixed

- Embargo text leaking into performer/title/date extraction: "hold until Jan 15"
  was parsed as a band name and the embargo date was used as the event date.
  Added `removeEmbargoText()` to strip embargo phrases from the caption before
  extraction.
- VLM prompt now explicitly instructs the model to treat embargo/announcement
  dates as `announce_after`, never as the event `date`.
- OCR pipeline fallback hardening and robust date extraction improvements.

## [1.0.0] — 2026-06-08

### Added

- Initial release. Slack-to-website event ingest bot for Farewell Cafe and Howdy
  venues in Kansas City.
- Slack webhook receiver (`message.channels`, `message.groups`) using
  `slack-cloudflare-workers`.
- Vision AI pipeline: OCR via `@cf/meta/llama-3.2-11b-vision-instruct`,
  structured extraction via `@cf/meta/llama-3.1-8b-instruct`.
- Heuristic caption parser for dates, prices, times, and performers.
- Embargo support: "do not announce until <date>" stages events in KV with
  cron-based release (`*/15 * * * *`).
- R2 image storage, D1 event database, and interactive thread corrections.
- Custom domain route: `flyer-eater.farewellcafe.com`.
