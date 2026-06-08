import type { VLMExtract } from './types';
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
 * Uses a text-only LLM for reasoning, combining OCR text with caption hints.
 */
export async function parseTranscription(
  ai: Ai,
  ocrText: string,
  caption: string,
  venueHint: 'farewell' | 'howdy' | null
): Promise<Partial<VLMExtract>> {
  if (!ocrText || ocrText === 'NO_TEXT_FOUND') {
    return {};
  }

  const today = new Date().toISOString().split('T')[0];

  const systemPrompt = `
You are a data extraction assistant for DIY music venues in Kansas City: Farewell Cafe and Howdy.
Your job is to extract structured event data from messy OCR text.

Today's date is: ${today}. Use this to resolve relative dates like "this Saturday".

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
- Date MUST be YYYY-MM-DD. Assume the nearest upcoming occurrence from today.
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
