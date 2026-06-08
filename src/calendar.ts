import type { Env } from './types';

/**
 * Retrieves the OCR'd text of the relevant venue calendar from KV.
 * If not found, it returns null. 
 * 
 * Future improvement: If not found, we could trigger an OCR of the image
 * if we have a way to access the image buffer.
 */
export async function getCalendarText(
  env: Env,
  venue: 'farewell' | 'howdy',
  year: number,
  month: number
): Promise<string | null> {
  const key = `calendar_text_${venue}_${year}_${month}`;
  return await env.STAGING_KV.get(key);
}

/**
 * Stores OCR'd calendar text in KV.
 */
export async function storeCalendarText(
  env: Env,
  venue: 'farewell' | 'howdy',
  year: number,
  month: number,
  text: string
): Promise<void> {
  const key = `calendar_text_${venue}_${year}_${month}`;
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
