import type { Env, FarwhyEvent, VLMExtract } from './types';

function applyAutoPopulationRules(e: Partial<FarwhyEvent>): FarwhyEvent {
  const venue = e.venue ?? 'farewell';

  const age_restriction = e.age_restriction
    ?? (venue === 'howdy'
      ? 'All ages'
      : '21+ unless with parent or legal guardian');

  return {
    id: e.id ?? `event_${crypto.randomUUID()}`,
    title: e.title ?? 'TBA',
    date: e.date ?? new Date().toISOString().split('T')[0],
    venue,
    flyer_image_url: e.flyer_image_url ?? null,
    ticket_url: e.ticket_url ?? null,
    description: e.description ?? null,
    age_restriction,
    event_time: e.event_time ?? 'Doors at 7pm / Music at 8pm',
    price: e.price ?? null,
    capacity: e.capacity ?? null,
    status: e.status ?? 'active',
    is_featured: e.is_featured ?? false,
    event_type: e.event_type ?? 'music',
    performers: e.performers ?? '[]',
    tags: e.tags ?? '[]',
    external_links: e.external_links ?? '{}',
    slack_ts: e.slack_ts
  };
}

export function buildEvent(
  captionExtract: Partial<VLMExtract>,
  vlmExtract: Partial<VLMExtract>,
  venue: 'farewell' | 'howdy',
  flyerImageUrl: string,
  calendarText?: string | null
): { event: FarwhyEvent, warnings: string[] } {
  const warnings: string[] = [];

  // Plausibility guard: a lone caption "performer" not corroborated by the
  // calendar, when VLM (reading the actual flyer) found a fuller lineup, is
  // almost always caption noise (e.g. "V2") rather than a real performer.
  if (
    captionExtract.performers?.length === 1 &&
    calendarText &&
    vlmExtract.performers && vlmExtract.performers.length >= 2 &&
    !calendarText.toLowerCase().includes(captionExtract.performers[0].toLowerCase())
  ) {
    captionExtract = { ...captionExtract, performers: undefined, title: undefined };
    warnings.push('Caption performer guess discarded (not in calendar, VLM had fuller lineup)');
  }

  // Merge logic: VLM > caption > performers > default. VLM reads the flyer
  // itself (with calendar context) and is the more informed source for
  // content fields; caption remains the fallback when VLM comes up empty.
  let title = vlmExtract.title ?? captionExtract.title;
  if (!title && vlmExtract.performers?.length) title = vlmExtract.performers.join(' / ');
  if (!title && captionExtract.performers?.length) title = captionExtract.performers.join(' / ');

  if (!title) warnings.push('Title defaulted to TBA');

  // date and venue keep caption priority — staff deliberately use the
  // caption to correct a misprinted flyer date or disambiguate venue.
  const date = captionExtract.date ?? vlmExtract.date;
  if (!date) warnings.push('Date defaulted to today');

  const price = vlmExtract.price ?? captionExtract.price;
  const event_time = captionExtract.event_time ?? vlmExtract.event_time;
  const description = vlmExtract.description ?? captionExtract.description;

  // Merge performers and tags: prefer VLM, fallback to caption
  let performers = vlmExtract.performers;
  if (!performers || performers.length === 0) performers = captionExtract.performers;

  let tags = vlmExtract.tags;
  if (!tags || tags.length === 0) tags = captionExtract.tags;

  const partial: Partial<FarwhyEvent> = {
    venue,
    title: title ?? undefined,
    date: date ?? undefined,
    event_time: event_time ?? undefined,
    price: price ?? undefined,
    description: description ?? undefined,
    flyer_image_url: flyerImageUrl,
    performers: performers?.length ? JSON.stringify(performers) : '[]',
    tags: tags?.length ? JSON.stringify(tags) : '[]',
    external_links: '{}'
  };

  return {
    event: applyAutoPopulationRules(partial),
    warnings
  };
}

export async function insertEvent(env: Env, event: FarwhyEvent): Promise<string> {
  await env.DB.prepare(`
    INSERT INTO events (
      id, title, date, venue, ticket_url, flyer_image_url, description,
      age_restriction, event_time, price, capacity, status, is_featured,
      event_type, performers, tags, external_links, slack_ts, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    event.id,
    event.title,
    event.date,
    event.venue,
    event.ticket_url ?? null,
    event.flyer_image_url ?? null,
    event.description ?? null,
    event.age_restriction,
    event.event_time,
    event.price ?? null,
    event.capacity ?? null,
    event.status,
    event.is_featured ? 1 : 0,
    event.event_type,
    event.performers,
    event.tags,
    event.external_links,
    event.slack_ts ?? null
  ).run();

  return event.id;
}

export async function getAllEvents(env: Env): Promise<FarwhyEvent[]> {
  const { results } = await env.DB.prepare(`
    SELECT * FROM events ORDER BY date DESC
  `).all<FarwhyEvent>();
  return results;
}

export async function getEventBySlackTs(env: Env, slackTs: string): Promise<FarwhyEvent | null> {
  // We need to store slack_ts in the DB to make this work efficiently.
  // For now, let's assume we might need to add that column or search by metadata if available.
  // Actually, let's add a slack_ts column to the events table if it doesn't exist.
  const result = await env.DB.prepare(`
    SELECT * FROM events WHERE slack_ts = ? LIMIT 1
  `).bind(slackTs).first<FarwhyEvent>();
  return result;
}

// Fields an LLM-driven correction (staff thread reply, calendar validation)
// is allowed to touch. Anything else returned by an LLM is dropped here
// rather than interpolated into the SQL SET clause as a column name.
export const CORRECTABLE_FIELDS = new Set<keyof FarwhyEvent>([
  'title', 'date', 'venue', 'event_time', 'price', 'description',
  'age_restriction', 'performers', 'tags'
]);

export async function updateEvent(env: Env, id: string, updates: Partial<FarwhyEvent>): Promise<void> {
  const keys = (Object.keys(updates) as (keyof FarwhyEvent)[])
    .filter(k => CORRECTABLE_FIELDS.has(k));
  if (keys.length === 0) return;

  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => updates[k]);

  await env.DB.prepare(`
    UPDATE events SET ${setClause}, updated_at = datetime('now') WHERE id = ?
  `).bind(...values, id).run();
}

export async function deleteEvent(env: Env, id: string): Promise<void> {
  await env.DB.prepare(`
    DELETE FROM events WHERE id = ?
  `).bind(id).run();
}
