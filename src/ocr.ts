import type { VLMExtract, FarwhyEvent } from './types';
import { safeParseJson } from './json_utils';

// A single flyer's text is short; a full-month calendar grid (one per venue)
// has ~30 date entries with multiple bands each and needs much more room —
// 512 tokens was cutting calendar transcription off partway through the month.
const FLYER_MAX_TOKENS = 768;

/**
 * Step 1: Transcribe the flyer image to raw text.
 * Uses the vision model for OCR only, minimizing hallucination.
 */
export async function transcribeFlyer(
  ai: Ai,
  imageBuffer: ArrayBuffer,
  options: { maxTokens?: number } = {}
): Promise<string> {
  const prompt = `
Read and transcribe ALL visible text on this concert flyer image.
Include every word, number, date, time, price, and band name you can see.
Do not interpret or format, just output the raw transcribed text exactly as it appears.
If you cannot read anything, output "NO_TEXT_FOUND".
  `.trim();

  try {
    const response = await ai.run(
      '@cf/meta/llama-3.2-11b-vision-instruct',
      {
        image: [...new Uint8Array(imageBuffer)],
        prompt,
        max_tokens: options.maxTokens ?? FLYER_MAX_TOKENS,
        temperature: 0
      }
    );

    // This model's output is { response: string }, not { description: string }
    // (description is only present on image-captioning models like llava).
    return (response as any).response ?? (response as any).description ?? '';
  } catch (err) {
    console.error('[OCR] Failed to transcribe image:', err);
    return '';
  }
}

/**
 * Step 2: Parse the raw OCR text into structured JSON.
 * Uses a text-only LLM for reasoning, combining OCR text with caption hints
 * and optional official calendar text.
 */
export async function parseTranscription(
  ai: Ai,
  ocrText: string,
  caption: string,
  venueHint: 'farewell' | 'howdy' | null,
  calendarText: string | null = null
): Promise<Partial<VLMExtract>> {
  const hasOcrText = !!ocrText && ocrText !== 'NO_TEXT_FOUND';
  if (!hasOcrText && !caption && !calendarText) {
    return {};
  }

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `
You are a data extraction assistant for DIY music venues in Kansas City: Farewell Cafe and Howdy.
Your job is to extract structured event data from messy OCR text.

Today's date is: ${today}. Use this to resolve relative dates like "this Saturday".

${calendarText ? `
OFFICIAL VENUE CALENDAR (The HIGHEST source of truth):
"""
${calendarText}
"""
If any band names or dates in the flyer match an entry in this calendar,
USE THE CALENDAR DATA as the primary source of truth for spelling, dates, and lineups.
If the RAW OCR TEXT below is empty or unreadable, find the entry in this calendar
matching the date/venue implied by the SLACK CAPTION and extract the event from there instead.
` : ''}

Return ONLY a valid JSON object with these keys. If a value cannot be determined, use null.
{
  "title": "< headline act or combined performers, string >",
  "date": "<YYYY-MM-DD>",
  "event_time": "<e.g. '8pm' or 'Doors 7 / Show 8', string or null>",
  "price": "<e.g. 'PWYC / $10' or '$8' or 'Free', string or null>",
  "performers": ["<Band Name (City, ST)>", ...],
  "tags": ["<genre or descriptor>", ...],
  "description": "<1-2 sentence description of the show, string or null>",
  "venue_hint": "<'farewell' or 'howdy' or null>",
  "announce_after": "<ISO date string if there's an embargo, else null>"
}

RULES:
- "pwyc", "pay what you can", "sliding scale" -> normalize the label to "PWYC", but
  a dollar amount printed on the flyer MUST always appear in the price field too —
  it is more useful than the PWYC label alone. E.g. "$10-15 PWYC" -> "PWYC ($10-15)",
  "PWYC, $5 min" -> "PWYC ($5 min)". Only output plain "PWYC" if no dollar figure
  appears anywhere in the OCR text or caption.
- Performers array: include city/state if visible, e.g. "Band (KC)"
- Title: If there isn't a clear show title, use the headline band or join the top 3 bands with " / ".
- Date MUST be YYYY-MM-DD and MUST be the actual event date, not an announcement/embargo date.
- PRIORITY: If the SLACK CAPTION contains a date (like "06.18.26"), USE THAT DATE instead of guessing from the flyer text.
- If the caption or flyer text mentions "hold until", "do not announce until", or "embargo:" then extract that as announce_after, NOT as the event date.
- If no year is provided, assume the nearest upcoming occurrence from today.
- Output ONLY raw JSON. No markdown fences.
  `.trim();

  const userPrompt = `
SLACK CAPTION (human provided context):
"${caption}"
${venueHint ? `VENUE ALREADY IDENTIFIED FROM CAPTION: ${venueHint}` : ''}

RAW OCR TEXT FROM FLYER:
"""
${hasOcrText ? ocrText : 'NO_TEXT_FOUND — flyer OCR failed or was unreadable. Rely on the calendar/caption above.'}
"""
  `.trim();

  const bodyPayload = {
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 512,
    temperature: 0
  };

  let aiResult: any;
  try {
    // In Workers AI, the llama-3.1-8b-instruct-fp8 model is a good default text model.
    aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', bodyPayload);
  } catch (err) {
    console.error('[OCR] Failed to parse transcription with AI:', err);
    return {};
  }

  const rawResult = aiResult.response || aiResult.result || aiResult.description || '';
  const parsed = safeParseJson<VLMExtract>(rawResult);

  if (!parsed) {
    console.error('[OCR] Failed to parse JSON from text LLM response:', rawResult);
    return {};
  }

  return parsed;
}

// Corrections may include announce_after (embargo timestamp), which lives
// on StagedEvent, not FarwhyEvent — it's not a D1 column.
export type Correction = Partial<FarwhyEvent> & { announce_after?: string | null };

/**
 * Step 3: Parse natural language corrections from a user reply.
 * Extracts updated fields based on what the user typed.
 */
export async function parseCorrections(
  ai: Ai,
  userText: string,
  currentEvent: FarwhyEvent
): Promise<Correction> {
  const systemPrompt = `
You are an event data editor. A user is providing a correction for an existing concert event.
Current event details:
${JSON.stringify(currentEvent, null, 2)}

Your task is to extract only the fields the user wants to change and return them as a JSON object.
Valid fields: title, date (YYYY-MM-DD), venue (farewell/howdy), event_time, price, description,
age_restriction, announce_after (ISO date string — use this ONLY for "hold until X" /
"do not announce until X" / "embargo: X" style corrections, NEVER for the event date itself).

RULES:
- If the user says "it's at howdy", return {"venue": "howdy"}
- If the user says "date is actually June 15", return {"date": "2026-06-15"}
- If the user says "hold until July 20" or "don't announce until Aug 1", return {"announce_after": "2026-07-20"}
- If they change performers, return {"performers": "[\"New Band 1\", \"New Band 2\"]"} (JSON array string)
- If nothing in the message is a correction, return {}
- Output ONLY raw JSON. No markdown fences.
`.trim();

  try {
    const aiResult: any = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      max_tokens: 256,
      temperature: 0
    });

    const rawResult = aiResult.response || aiResult.result || aiResult.description || '';
    return safeParseJson<Correction>(rawResult) ?? {};
  } catch (err) {
    console.error('[OCR] Failed to parse corrections:', err);
    return {};
  }
}
