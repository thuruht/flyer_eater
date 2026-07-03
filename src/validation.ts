import type { Env, FarwhyEvent } from './types';
import { getAllEvents, updateEvent } from './db';
import { getCalendarText } from './calendar';
import { safeParseJson } from './json_utils';

/**
 * Validates existing events in the DB against stored venue calendars.
 * This can be run on a schedule or triggered manually with filters.
 */
export async function validateEventsAgainstCalendars(
  env: Env,
  filterVenue?: 'farewell' | 'howdy',
  filterYear?: number,
  filterMonth?: number
): Promise<number> {
  const events = await getAllEvents(env);
  let updateCount = 0;

  for (const event of events) {
    // 1. Apply explicit filters if provided
    if (filterVenue && event.venue !== filterVenue) continue;

    const [year, month] = event.date.split('-').map(Number);
    if (filterYear && year !== filterYear) continue;
    if (filterMonth && month !== filterMonth) continue;

    // 2. If no explicit filters, only validate future or recent events
    if (!filterVenue && !filterYear && !filterMonth) {
      const eventDate = new Date(event.date);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      if (eventDate < thirtyDaysAgo) continue;
    }

    const calendarText = await getCalendarText(env, event.venue, year, month);

    if (calendarText) {
      const updates = await checkEventAgainstCalendar(env.AI, event, calendarText);
      if (Object.keys(updates).length > 0) {
        await updateEvent(env, event.id, updates);
        updateCount++;
        console.log(`[validation] Corrected event ${event.id} (${event.title}) based on calendar.`);
      }
    }
  }

  return updateCount;
}

/**
 * Uses AI to check if an event's details match the official calendar.
 * Returns any necessary corrections.
 */
async function checkEventAgainstCalendar(
  ai: Ai,
  event: FarwhyEvent,
  calendarText: string
): Promise<Partial<FarwhyEvent>> {
  const systemPrompt = `
You are a data validator for music venues. Compare the current event data against the OFFICIAL VENUE CALENDAR.
If the calendar has more accurate info for this date/lineup, provide the CORRECTIONS.

CURRENT EVENT:
${JSON.stringify(event, null, 2)}

OFFICIAL CALENDAR:
"""
${calendarText}
"""

Return ONLY a JSON object of fields that need updating (title, date, performers, price, etc.).
If the event is correct, return {}.
Output ONLY raw JSON.
`.trim();

  try {
    const aiResult: any = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
      messages: [{ role: "system", content: systemPrompt }],
      max_tokens: 512,
      temperature: 0
    });
    const rawResult = aiResult.response || aiResult.result || aiResult.description || '';
    return safeParseJson<Partial<FarwhyEvent>>(rawResult) ?? {};
  } catch (err) {
    console.error(`[validation] Failed to check event ${event.id} against calendar:`, err);
    return {};
  }
}
