/**
 * caption_parser.ts — Extract structured event data from Slack caption text.
 *
 * This is a best-effort parser for human-typed captions that often accompany
 * flyer images in #flyers. When present, caption data is more reliable than
 * VLM extraction. Many posts have NO caption, in which case this returns
 * an empty partial and the VLM pipeline handles everything.
 *
 * Pattern examples:
 *   "Dry Rot (KC) + Gag (PDX), Jan 15 at Farewell, PWYC/$5"
 *   "June 7 - Howdy - Mall Bratz / Civic Center / Veil, $8"
 *   "show tomorrow at farewell, 8pm pwyc"
 *   "6/14 - hardcore matinee @ howdy - $5"
 */

import type { VLMExtract } from './types';

// ── Date extraction ─────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9,
  nov: 10, november: 10, dec: 11, december: 11
};

function resolveNearestDate(month: number, day: number): string {
  const now = new Date();
  const thisYear = now.getFullYear();

  // Try this year first; if it's already passed, use next year
  let candidate = new Date(thisYear, month, day);
  if (candidate.getTime() < now.getTime() - 86400000) {
    candidate = new Date(thisYear + 1, month, day);
  }
  return formatDate(candidate);
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function extractDate(text: string): string | null {
  const t = text.toLowerCase();

  // 1. ISO-ish or dots: 2026-06-14, 2026/06/14, 2026.06.14
  const isoMatch = text.match(/\b(20\d{2})[\/\.\-](0?[1-9]|1[0-2])[\/\.\-](0?[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 2. US numeric: 6/14, 06/14, 6.14.26, 06-14-2026, 06.18. (trailing dot)
  // We allow / . - or even spaces as separators.
  // The year part is optional (2 or 4 digits).
  const usMatch = text.match(/\b(0?[1-9]|1[0-2])[\/\.\-\s](0?[1-9]|[12]\d|3[01])(?:[\/\.\-\s](20\d{2}|\d{2}))?\.?\b/);
  if (usMatch) {
    const month = parseInt(usMatch[1], 10) - 1;
    const day = parseInt(usMatch[2], 10);
    // Ensure day is valid for month (loose check)
    if (day > 0 && day <= 31) {
      if (usMatch[3]) {
        let year = parseInt(usMatch[3], 10);
        if (year < 100) year += 2000;
        return formatDate(new Date(year, month, day));
      }
      return resolveNearestDate(month, day);
    }
  }

  // 3. Named month: "Jan 15", "January 15th", "15 Jan", "Jan 15, 2026"
  const namedMonths = Object.keys(MONTH_MAP).join('|');
  const namedMatch = text.match(
    new RegExp(`\\b(${namedMonths})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]+(20\\d{2}))?\\b`, 'i')
  );
  if (namedMatch) {
    const month = MONTH_MAP[namedMatch[1].toLowerCase()];
    const day = parseInt(namedMatch[2], 10);
    if (namedMatch[3]) {
      return formatDate(new Date(parseInt(namedMatch[3], 10), month, day));
    }
    return resolveNearestDate(month, day);
  }

  // 4. Reverse: "15 Jan", "15th of January"
  const reverseMatch = text.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${namedMonths})\\.?(?:[,\\s]+(20\\d{2}))?\\b`, 'i')
  );
  if (reverseMatch) {
    const day = parseInt(reverseMatch[1], 10);
    const month = MONTH_MAP[reverseMatch[2].toLowerCase()];
    if (reverseMatch[3]) {
      return formatDate(new Date(parseInt(reverseMatch[3], 10), month, day));
    }
    return resolveNearestDate(month, day);
  }

  // 5. Relative: "tomorrow", "tonight"
  if (/\b(tomorrow)\b/i.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }

  if (/\b(tonight|today)\b/i.test(t)) {
    return formatDate(new Date());
  }

  // "this friday", "this saturday", etc.
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const thisDayMatch = t.match(/\b(?:this\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (thisDayMatch) {
    const target = dayNames.indexOf(thisDayMatch[1].toLowerCase());
    const now = new Date();
    const current = now.getDay();
    let daysAhead = target - current;
    if (daysAhead <= 0) daysAhead += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    return formatDate(d);
  }

  return null;
}

// ── Price extraction ────────────────────────────────────────────────

function extractPrice(text: string): string | null {
  const t = text.toLowerCase();

  // PWYC variants with optional minimum
  const pwycMatch = text.match(/\b(?:p\.?w\.?y\.?c\.?|pay what you can|sliding scale)\b/i);
  const dollarMatch = text.match(/\$\s*(\d+)/);

  if (pwycMatch && dollarMatch) {
    return `PWYC / $${dollarMatch[1]} minimum`;
  }
  if (pwycMatch) {
    return 'PWYC';
  }
  if (/\bfree\b/i.test(t) && !dollarMatch) {
    return 'Free';
  }
  if (/\bdonation\b/i.test(t)) {
    return 'Donation';
  }
  if (dollarMatch) {
    return `$${dollarMatch[1]}`;
  }

  return null;
}

// ── Time extraction ─────────────────────────────────────────────────

function extractTime(text: string): string | null {
  // "doors 7 / show 8", "doors at 7pm / music at 8pm"
  const doorsShowMatch = text.match(
    /doors\s*(?:at\s*)?(\d{1,2})\s*(?:pm|am)?\s*[/,&]\s*(?:show|music)\s*(?:at\s*)?(\d{1,2})\s*(?:pm|am)?/i
  );
  if (doorsShowMatch) {
    return `Doors at ${doorsShowMatch[1]}pm / Music at ${doorsShowMatch[2]}pm`;
  }

  // Standalone time: "8pm", "8 pm", "8:00pm"
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(pm|am)\b/i);
  if (timeMatch) {
    const mins = timeMatch[2] ? `:${timeMatch[2]}` : '';
    return `${timeMatch[1]}${mins}${timeMatch[3].toLowerCase()}`;
  }

  return null;
}

// ── Performers extraction ───────────────────────────────────────────

// Words/phrases that are NOT performer names
const NON_PERFORMER_TOKENS = new Set([
  'at', 'the', 'a', 'and', 'with', 'w', 'vs', 'presents', 'present',
  'farewell', 'howdy', 'pwyc', 'free', 'donation', 'sliding', 'scale',
  'doors', 'show', 'music', 'pm', 'am', 'tonight', 'tomorrow', 'today',
  'this', 'next', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday',
  'saturday', 'sunday', 'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'january', 'february',
  'march', 'april', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'all', 'ages', '21+'
]);

const REVERSE_DATE_STRIP_RE = new RegExp(
  `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${Object.keys(MONTH_MAP).join('|')})\\w*(?:\\s*,?\\s*\\d{4})?\\b`,
  'gi'
);

function extractPerformers(text: string): string[] | null {
  // Look for segments separated by +, /, w/, "with", ","
  // after removing known date/price/time/venue fragments

  // Strip embargo/command phrases so "hold until Jan 15" doesn't become a band name
  let cleaned = text
    .replace(/do not announce until\s*[^\.\n]*/gi, '')
    .replace(/hold until\s*[^\.\n]*/gi, '')
    .replace(/embargo\s*:?\s*[^\.\n]*/gi, '')
    // Strip out date-like fragments, price, time, venue mentions
    .replace(/\b(20\d{2})[\/\.\-](0?[1-9]|1[0-2])[\/\.\-](0?[1-9]|[12]\d|3[01])\b/g, '')
    .replace(/\b(0?[1-9]|1[0-2])[\/\.\-\s](0?[1-9]|[12]\d|3[01])(?:[\/\.\-\s](20\d{2}|\d{2}))?\.?\b/g, '')
    .replace(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?\b/gi, '')
    .replace(REVERSE_DATE_STRIP_RE, '')
    .replace(/\b(?:tonight|tomorrow|today|this\s+\w+day)\b/gi, '')
    .replace(/\$\s*\d+/g, '')
    .replace(/\b(?:p\.?w\.?y\.?c\.?|pay what you can|sliding scale|free|donation)\b/gi, '')
    .replace(/\bdoors?\s*(?:at\s*)?\d{1,2}\s*(?:pm|am)?\s*[/,&]\s*(?:show|music)\s*(?:at\s*)?\d{1,2}\s*(?:pm|am)?\b/gi, '')
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:pm|am)\b/gi, '')
    .replace(/\b(?:at\s+)?(?:farewell|howdy)\b/gi, '')
    .replace(/\b6515\b/g, '')
    .replace(/\bv\d+\b/gi, '')
    .replace(/\bpt\.?\s*\d+\b/gi, '')
    .replace(/\b(?:repost|reup|re-up|revised|updated?|redo)\b:?\s*/gi, '')
    .replace(/[-–—@]\s*/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) return null;

  // Split on delimiters: +, /, w/, "with", ","
  const parts = cleaned
    .split(/\s*(?:\+|\/|,)\s*|\s+(?:w\/|with)\s+/i)
    .map(s => s.trim())
    .filter(s => {
      if (s.length < 2) return false;
      const lower = s.toLowerCase();
      // Filter out single tokens that are known non-performers
      const words = lower.split(/\s+/);
      if (words.length === 1 && NON_PERFORMER_TOKENS.has(words[0])) return false;
      // Filter out if ALL words are non-performer tokens
      if (words.every(w => NON_PERFORMER_TOKENS.has(w))) return false;
      return true;
    });

  return parts.length > 0 ? parts : null;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Parse a Slack caption for event data. Returns a partial VLMExtract
 * containing whatever could be extracted. Missing fields are undefined.
 * If the caption is empty or yields nothing, all fields will be undefined.
 */
export function parseCaption(caption: string): Partial<VLMExtract> {
  if (!caption || caption.trim().length === 0) {
    return {};
  }

  const text = caption.trim();
  const result: Partial<VLMExtract> = {};

  const date = extractDate(text);
  if (date) result.date = date;

  const price = extractPrice(text);
  if (price) result.price = price;

  const time = extractTime(text);
  if (time) result.event_time = time;

  const performers = extractPerformers(text);
  if (performers && performers.length > 0) {
    result.performers = performers;
    // Use first performer or combined names as title if we got performers
    result.title = performers.join(' / ');
  }

  return result;
}
