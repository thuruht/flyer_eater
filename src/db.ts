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
    external_links: e.external_links ?? '{}'
  };
}

export function buildEventFromVLM(
  extract: VLMExtract,
  venue: 'farewell' | 'howdy',
  flyerImageUrl: string
): FarwhyEvent {
  const partial: Partial<FarwhyEvent> = {
    venue,
    title: extract.title ?? undefined,
    date: extract.date ?? undefined,
    event_time: extract.event_time ?? undefined,
    price: extract.price ?? undefined,
    description: extract.description ?? undefined,
    flyer_image_url: flyerImageUrl,
    performers: extract.performers?.length
      ? JSON.stringify(extract.performers)
      : '[]',
    tags: extract.tags?.length
      ? JSON.stringify(extract.tags)
      : '[]',
    external_links: '{}'
  };
  return applyAutoPopulationRules(partial);
}

export async function insertEvent(env: Env, event: FarwhyEvent): Promise<string> {
  await env.DB.prepare(`
    INSERT INTO events (
      id, title, date, venue, ticket_url, flyer_image_url, description,
      age_restriction, event_time, price, capacity, status, is_featured,
      performers, tags, external_links, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
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
    event.performers,
    event.tags,
    event.external_links
  ).run();

  return event.id;
}
