import type { Env, VLMExtract } from './types';

export async function extractEventData(
  ai: Ai,
  imageBuffer: ArrayBuffer,
  caption: string,
  venueHint: 'farewell' | 'howdy' | null
): Promise<VLMExtract> {

  const prompt = `
You are analyzing a concert flyer for one of two adjacent Kansas City
DIY music venues: Farewell Cafe (21+, 6515 Stadium Dr) and Howdy
(all-ages, next door).

SLACK POST CAPTION (use this as ground truth to resolve ambiguous text
on the flyer):
"${caption}"

${venueHint ? `VENUE ALREADY IDENTIFIED FROM CAPTION: ${venueHint}` : ''}

Extract the following and return ONLY a single valid JSON object with
these exact keys. If a value cannot be determined, use null.

{
  "title": "<headline act or overall show title, string>",
  "date": "<YYYY-MM-DD>",
  "event_time": "<e.g. '8pm' or 'Doors 7 / Show 8', string or null>",
  "price": "<e.g. 'PWYC / $10' or '$8' or 'Free', string or null>",
  "performers": ["<Band Name (City, ST)>", ...],
  "tags": ["<genre or descriptor>", ...],
  "description": "<1-2 sentence description of the show, string or null>",
  "venue_hint": "<'farewell' or 'howdy' or null, based on flyer text>",
  "announce_after": "<ISO date string if flyer says 'do not announce until X', else null>"
}

IMPORTANT RULES:
- "p.w.y.c", "pwyc", "pay what you can", and "sliding scale" are all
  equivalent — normalize to "PWYC" in the price field, append any
  listed minimum dollar amount, e.g. "PWYC / $5 minimum".
- performers array entries must include city/state origin if visible,
  e.g. "The Band (Kansas City, MO)". If origin is unknown, omit parens.
- date must be YYYY-MM-DD. If only month/day visible, assume the
  nearest upcoming occurrence from today's date.
- Do not include markdown, code fences, or any text outside the JSON.
`;

  const response = await ai.run(
    '@cf/meta/llama-3.2-11b-vision-instruct',
    {
      image: [...new Uint8Array(imageBuffer)],
      prompt,
      max_tokens: 512
    }
  );

  const raw = (response as any).description ?? '';
  const cleaned = raw.replace(/```json|```/g, '').trim();

  try {
    return JSON.parse(cleaned) as VLMExtract;
  } catch {
    console.error('[OCR] Failed to parse VLM response:', raw);
    return {};
  }
}
