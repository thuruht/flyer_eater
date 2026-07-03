# Extraction Trust Hierarchy Fix

Status: Approved (pending written-spec review)
Date: 2026-07-02
Scope: `src/caption_parser.ts`, `src/db.ts` (`buildEvent`)
Out of scope: event identity / flyer versioning (tracked as a separate follow-up spec)

## Problem

A flyer was posted with caption `"07.23.26 Howdy V2"` and flyer text reading a five-band
lineup (VELVET, The Ritornello Form, Granule, Dreamist, How To Make A Bomb) plus
`$15 pwyc / all ages`. The bot published the event with `title = "V2"`, `performers = ["V2"]`,
and `price = "TBD"` — discarding the real lineup and price that the OCR/vision pipeline
had access to.

### Root cause (traced, not hypothesized)

1. `extractPerformers()` in `caption_parser.ts` strips known non-performer fragments
   (dates, venue names, price, time) from the caption, then treats whatever remains as
   performer names. It has no concept of version/revision markers. For
   `"07.23.26 Howdy V2"`, stripping removes the date and "Howdy", leaving `"V2"`, which
   survives because `NON_PERFORMER_TOKENS` has no entry for it. Result:
   `captionExtract.performers = ["V2"]`, `captionExtract.title = "V2"`.

2. `buildEvent()` in `db.ts` merges caption and VLM data with caption as the
   unconditional default for `title`, `performers`, `price`, `tags`, `description`,
   falling back to VLM only when the caption's value is empty:
   ```
   let title = captionExtract.title ?? vlmExtract.title;
   let performers = captionExtract.performers;
   if (!performers || performers.length === 0) performers = vlmExtract.performers;
   ```
   Since the caption produced a *non-empty* (but garbage) performer list, the real
   VLM-extracted lineup was never consulted — even though `parseTranscription()`
   (the VLM step) already receives calendar text and is explicitly instructed to treat
   it as the highest-priority source of truth. The caption is allowed to override a
   more-informed answer with a less-informed one.

Price showing "TBD" is a related but separately-diagnosed issue: the caption had no
price info, so `price` correctly fell back to `vlmExtract.price` — meaning the vision
pipeline itself failed to extract "$15 pwyc" for this flyer. That failure is not
addressed by this spec (see Open Issue below); this spec only stops caption garbage
from overriding *good* VLM data when VLM does produce it.

## Design

Three coordinated changes, all confined to the caption/VLM merge step. No changes to
the VLM prompt, calendar ingestion, or D1 schema.

### 1. Flip default precedence for content fields

In `buildEvent()`, `title`, `performers`, `price`, `tags`, `description` change from
"caption wins, VLM is fallback" to "VLM wins, caption is fallback":

```
let title = vlmExtract.title ?? captionExtract.title;
let performers = vlmExtract.performers;
if (!performers || performers.length === 0) performers = captionExtract.performers;
// same pattern for price, tags, description
```

`date` and `venue` are **not** changed — they keep caption priority. Employees
routinely use the caption to deliberately correct a misprinted flyer date or to
disambiguate Farewell vs. Howdy, and that's a valuable, intentional signal distinct
from performers/title/price being incidentally guessed from caption noise.

### 2. Plausibility guard (defense in depth)

Even with precedence flipped, a future flyer could hit a VLM extraction failure
(empty `vlmExtract.performers`) at the same time the caption produces a spurious
single-name guess — falling through to the bad caption data exactly as today. Add an
explicit guard in `buildEvent()`, evaluated before the fallback logic in (1):

```
if (
  captionExtract.performers?.length === 1 &&
  calendarText &&
  vlmExtract.performers?.length >= 2 &&
  !calendarText.toLowerCase().includes(captionExtract.performers[0].toLowerCase())
) {
  // caption's lone "performer" isn't corroborated by the calendar and VLM
  // already found a fuller lineup — discard the caption guess entirely.
  captionExtract.performers = undefined;
  captionExtract.title = undefined;
  warnings.push('Caption performer guess discarded (not in calendar, VLM had fuller lineup)');
}
```

This requires threading `calendarText` (already fetched in `index.ts` before
`buildEvent()` is called) into `buildEvent()`'s signature. `buildEvent` currently
takes `(captionExtract, vlmExtract, venue, flyerImageUrl)` — this becomes
`(captionExtract, vlmExtract, venue, flyerImageUrl, calendarText)`.

The guard is intentionally narrow (single-performer caption vs. multi-performer VLM,
with calendar as the arbiter) — it targets the exact failure class seen today without
trying to be a general-purpose "which source is right" classifier.

### 3. Strip version/revision tokens at the source

Independent of (1) and (2), fix `extractPerformers()` in `caption_parser.ts` so
version/revision markers never become a "performer" in the first place. Add a strip
pass before the delimiter split, alongside the existing date/price/time/venue strips:

```
.replace(/\bv\d+\b/gi, '')
.replace(/\bpt\.?\s*\d+\b/gi, '')
.replace(/\b(repost|reup|re-up|revised|updated|redo)\b/gi, '')
```

This is the most direct fix for today's specific bug and stands on its own even if
(1) and (2) were somehow bypassed (e.g. a future call site that constructs an event
from caption data alone).

## Data flow after the fix

```
caption text ──▶ parseCaption() ──▶ captionExtract (version tokens now stripped)
flyer image  ──▶ transcribeFlyer() + parseTranscription(calendarText) ──▶ vlmExtract
                                                                              │
calendarText ─────────────────────────────────────────────────────────────┘
                                                                              ▼
                                                          buildEvent(captionExtract,
                                                                     vlmExtract,
                                                                     venue,
                                                                     imageUrl,
                                                                     calendarText)
                                                                              │
                                                          plausibility guard (2)
                                                                              │
                                                          VLM-first merge (1)
                                                                              ▼
                                                                    FarwhyEvent
```

## Error handling

- If `calendarText` is `null` (no calendar ingested for that venue/month), the
  plausibility guard simply can't run its calendar check and is skipped — behavior
  falls back to the flipped default precedence from (1) alone. This is a strict
  improvement over today regardless.
- If both `vlmExtract` and `captionExtract` are empty for a field, existing
  `applyAutoPopulationRules()` defaults (`'TBA'`, today's date, etc.) and existing
  `warnings` array behavior (e.g. "Title defaulted to TBA") are unchanged.

## Testing

- Unit test `extractPerformers()` directly: caption `"07.23.26 Howdy V2"` must return
  `null` performers (not `["V2"]`). Add cases for `"pt 2"`, `"repost"`, `"v3"`.
- Unit test `buildEvent()`: given a `captionExtract` with a single implausible
  performer, a `vlmExtract` with a real multi-band lineup, and calendar text that
  doesn't mention the caption's guess — assert the final event uses the VLM lineup.
- Unit test `buildEvent()`: given no `calendarText` at all, same inputs — assert the
  flipped default precedence (1) still wins on its own (VLM lineup used).
- Regression test: a caption that legitimately provides a correction not present in
  VLM output (e.g. VLM extraction totally failed, caption has the only readable info)
  must still populate the event from the caption — precedence flip must not make
  caption data unusable when it's the *only* data.

## Open issue (explicitly not fixed by this spec)

Price extraction returning "TBD" for a flyer that clearly printed "$15 pwyc" points to
a failure in `transcribeFlyer()` / `parseTranscription()` itself (OCR not reading the
price line, or the JSON parse silently dropping it). This spec does not address that —
it needs log inspection (`[STAGE: VLM_EXTRACTION]`) on a real occurrence to diagnose,
and is a candidate for a separate, narrower investigation.
