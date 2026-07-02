import type { Env } from './types';

function calendarKeyPrefix(venue: 'farewell' | 'howdy', year: number, month: number): string {
  return `calendar_text_${venue}_${year}_${month}_`;
}

/**
 * Retrieves the OCR'd text of the relevant venue calendar from KV.
 * Multiple calendar images may have been posted for the same venue/month
 * (e.g. a split photo, or a later corrected re-shoot); all of them are
 * stored under distinct keys and joined here so nothing is silently lost.
 * Returns null if no calendar text has been stored for this venue/month.
 */
export async function getCalendarText(
  env: Env,
  venue: 'farewell' | 'howdy',
  year: number,
  month: number
): Promise<string | null> {
  const prefix = calendarKeyPrefix(venue, year, month);
  const list = await env.STAGING_KV.list({ prefix });
  if (list.keys.length === 0) return null;

  const texts = await Promise.all(
    list.keys.map(k => env.STAGING_KV.get(k.name))
  );
  const nonEmpty = texts.filter((t): t is string => !!t);
  if (nonEmpty.length === 0) return null;

  return nonEmpty.join('\n\n---\n\n');
}

/**
 * Stores OCR'd calendar text in KV under a per-post key so a second
 * calendar image for the same venue/month doesn't overwrite the first.
 */
export async function storeCalendarText(
  env: Env,
  venue: 'farewell' | 'howdy',
  year: number,
  month: number,
  text: string,
  timestamp: number = Date.now()
): Promise<void> {
  const key = `${calendarKeyPrefix(venue, year, month)}${timestamp}`;
  // Store for at least 60 days to cover the month and any late lookups
  await env.STAGING_KV.put(key, text, { expirationTtl: 60 * 24 * 60 * 60 });
}

/**
 * Formats a month number to a string (e.g., 6 -> "june").
 */
export function getMonthName(month: number): string {
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  return months[month - 1];
}

/**
 * Utility to parse month/year from a filename like "farewell_bw_cal_june_2026.png"
 */
export function parseCalendarFilename(filename: string) {
  const parts = filename.split('_');
  const venue = parts[0] as 'farewell' | 'howdy';
  const monthName = parts[3];
  const year = parseInt(parts[4].split('.')[0], 10);
  
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const month = months.indexOf(monthName.toLowerCase()) + 1;
  
  return { venue, year, month };
}
