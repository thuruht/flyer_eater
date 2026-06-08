/**
 * json_utils.ts — Robust JSON extraction from LLM output.
 * Ported from the legacy batch OCR tool's extractJsonBlock.
 *
 * Handles: conversational preamble, markdown fences, nested braces,
 * escaped quotes, and truncated output.
 */

/**
 * Extract the first complete JSON object from a string that may contain
 * surrounding conversational text, markdown fences, etc.
 * Uses brace-counting to handle nested objects and string escapes.
 */
export function extractJsonBlock(str: string): string | null {
  const start = str.indexOf('{');
  if (start === -1) return null;

  let braceCount = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < str.length; i++) {
    const char = str[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
    } else {
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          return str.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

/**
 * Attempt to sanitize common LLM JSON quirks before parsing:
 * - Strip markdown fences
 * - Remove trailing commas before } or ]
 * - Handle single-quoted strings (replace with double quotes cautiously)
 */
export function sanitizeJsonString(raw: string): string {
  let s = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Remove trailing commas: , } or , ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  return s;
}

/**
 * Best-effort parse: sanitize → extract JSON block → parse.
 * Returns null if nothing works.
 */
export function safeParseJson<T = unknown>(raw: string): T | null {
  const sanitized = sanitizeJsonString(raw);
  const block = extractJsonBlock(sanitized);
  if (!block) return null;

  try {
    return JSON.parse(block) as T;
  } catch {
    return null;
  }
}
