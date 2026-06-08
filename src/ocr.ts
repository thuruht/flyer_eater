import type { VLMExtract, FarwhyEvent } from './types';
import { safeParseJson } from './json_utils';

/**
 * Step 1: Transcribe the flyer image to raw text.
 * Uses the vision model for OCR only, minimizing hallucination.
 */
export async function transcribeFlyer(
  ai: Ai,
  imageBuffer: ArrayBuffer
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
        max_tokens: 512,
        temperature: 0
      }
    );

    return (response as any).description ?? '';
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
  if (!ocrText || ocrText === 'NO_TEXT_FOUND') {
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
` : ''}

Return ONLY a valid JSON object with these keys. If a value cannot be determined, use null.
{
  "title": "<headline act or overall show title, string>",
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
- "pwyc", "pay what you can", "sliding scale" -> normalize to "PWYC"
- Performers array: include city/state if visible, e.g. "Band (KC)"
- Date MUST be YYYY-MM-DD. 
- PRIORITY: If the SLACK CAPTION contains a date (like "06.18.26"), USE THAT DATE instead of guessing from the flyer text.
- If no year is provided, assume the nearest upcoming occurrence from today.
- Output ONLY raw JSON. No markdown fences.
  `.trim();

  const userPrompt = `
SLACK CAPTION (human provided context):
"${caption}"
${venueHint ? `VENUE ALREADY IDENTIFIED FROM CAPTION: ${venueHint}` : ''}

RAW OCR TEXT FROM FLYER:
"""
${ocrText}
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
    // We try to use a strong text model. If it fails, we fall back to another or return {}
    // In Workers AI, the llama-3.1-8b-instruct model is a good default text model.
    aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct', bodyPayload);
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

/**
 * Step 3: Parse natural language corrections from a user reply.
 * Extracts updated fields based on what the user typed.
 */
export async function parseCorrections(
  ai: Ai,
  userText: string,
  currentEvent: FarwhyEvent
): Promise<Partial<FarwhyEvent>> {
  const systemPrompt = `
You are an event data editor. A user is providing a correction for an existing concert event.
Current event details:
${JSON.stringify(currentEvent, null, 2)}

Your task is to extract only the fields the user wants to change and return them as a JSON object.
Valid fields: title, date (YYYY-MM-DD), venue (farewell/howdy), event_time, price, description, age_restriction.

RULES:
- If the user says "it's at howdy", return {"venue": "howdy"}
- If the user says "date is actually June 15", return {"date": "2026-06-15"}
- If they change performers, return {"performers": "[\"New Band 1\", \"New Band 2\"]"} (JSON array string)
- Output ONLY raw JSON. No markdown fences.
`.trim();

  try {
    const aiResult: any = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      max_tokens: 256,
      temperature: 0
    });

    const rawResult = aiResult.response || aiResult.result || aiResult.description || '';
    return safeParseJson<Partial<FarwhyEvent>>(rawResult) ?? {};
  } catch (err) {
    console.error('[OCR] Failed to parse corrections:', err);
    return {};
  }
}
