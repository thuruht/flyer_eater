import { SlackEdgeAppEnv } from 'slack-cloudflare-workers';

// Mirrors farwhy_uni Event interface exactly — field names must match D1 columns
export interface FarwhyEvent {
  id: string;
  title: string;
  date: string;                    // YYYY-MM-DD
  venue: 'farewell' | 'howdy';
  flyer_image_url?: string | null;
  ticket_url?: string | null;
  description?: string | null;
  age_restriction?: string;
  event_time?: string;
  price?: string | null;
  capacity?: number | null;
  status: 'active' | 'cancelled' | 'postponed';
  is_featured: boolean;
  event_type: string;
  performers: string;              // JSON array string
  tags: string;                    // JSON array string
  external_links: string;          // JSON object string
}

// Raw output from the VLM before auto-population
export interface VLMExtract {
  title?: string;
  date?: string;                   // model should return YYYY-MM-DD
  venue_hint?: string;             // raw text clue, not yet normalized
  event_time?: string;
  price?: string;                  // e.g. "PWYC / $10" or "$8"
  performers?: string[];           // array of "Band Name (City)" strings
  tags?: string[];
  description?: string;
  announce_after?: string | null;  // ISO string or null
}

// Shape of objects stored in STAGING_KV
export interface StagedEvent {
  eventData: FarwhyEvent;
  r2Key: string;                   // e.g. "flyers/1234567890-abc.jpg"
  slackTs: string;
  announceAfter: number;           // unix seconds
}

// Env interface for this Worker — bindings match wrangler.jsonc
export interface Env extends SlackEdgeAppEnv {
  AI: Ai;
  DB: D1Database;
  IMAGES: R2Bucket;
  STAGING_KV: KVNamespace;
}
