import { describe, it, expect } from 'vitest';
import { buildEvent } from './db';
import type { VLMExtract } from './types';

describe('buildEvent — VLM-first precedence', () => {
  it('prefers VLM performers/title/price over non-empty caption values', () => {
    const captionExtract: Partial<VLMExtract> = {
      performers: ['V2'],
      title: 'V2'
    };
    const vlmExtract: Partial<VLMExtract> = {
      title: 'VELVET / The Ritornello Form / Granule',
      performers: ['VELVET', 'The Ritornello Form', 'Granule'],
      price: '$15 pwyc'
    };

    const { event } = buildEvent(captionExtract, vlmExtract, 'howdy', 'https://example.com/flyer.jpg');

    expect(JSON.parse(event.performers)).toEqual(['VELVET', 'The Ritornello Form', 'Granule']);
    expect(event.title).toBe('VELVET / The Ritornello Form / Granule');
    expect(event.price).toBe('$15 pwyc');
  });

  it('keeps caption priority for date and venue', () => {
    const captionExtract: Partial<VLMExtract> = { date: '2026-07-23' };
    const vlmExtract: Partial<VLMExtract> = { date: '2026-07-24' };

    const { event } = buildEvent(captionExtract, vlmExtract, 'howdy', 'https://example.com/flyer.jpg');

    expect(event.date).toBe('2026-07-23');
  });

  it('falls back to caption when VLM extraction is empty (caption-only data must still work)', () => {
    const captionExtract: Partial<VLMExtract> = {
      title: 'Dry Rot / Gag',
      performers: ['Dry Rot', 'Gag'],
      price: '$5'
    };
    const vlmExtract: Partial<VLMExtract> = {};

    const { event } = buildEvent(captionExtract, vlmExtract, 'farewell', 'https://example.com/flyer.jpg');

    expect(JSON.parse(event.performers)).toEqual(['Dry Rot', 'Gag']);
    expect(event.title).toBe('Dry Rot / Gag');
    expect(event.price).toBe('$5');
  });
});

describe('buildEvent — plausibility guard', () => {
  it('discards an uncorroborated single-performer caption guess when VLM has a fuller lineup', () => {
    const captionExtract: Partial<VLMExtract> = { performers: ['V2'], title: 'V2' };
    const vlmExtract: Partial<VLMExtract> = {
      performers: ['VELVET', 'The Ritornello Form', 'Granule', 'Dreamist', 'How To Make A Bomb'],
      title: 'VELVET / The Ritornello Form / Granule / Dreamist / How To Make A Bomb'
    };
    const calendarText = 'July 23: Howdy presents VELVET, The Ritornello Form, Granule, Dreamist, How To Make A Bomb';

    const { event, warnings } = buildEvent(
      captionExtract, vlmExtract, 'howdy', 'https://example.com/flyer.jpg', calendarText
    );

    expect(JSON.parse(event.performers)).toEqual([
      'VELVET', 'The Ritornello Form', 'Granule', 'Dreamist', 'How To Make A Bomb'
    ]);
    expect(warnings).toContain('Caption performer guess discarded (not in calendar, VLM had fuller lineup)');
  });

  it('still uses VLM-first precedence with no calendarText at all', () => {
    const captionExtract: Partial<VLMExtract> = { performers: ['V2'], title: 'V2' };
    const vlmExtract: Partial<VLMExtract> = {
      performers: ['VELVET', 'The Ritornello Form'],
      title: 'VELVET / The Ritornello Form'
    };

    const { event } = buildEvent(captionExtract, vlmExtract, 'howdy', 'https://example.com/flyer.jpg');

    expect(JSON.parse(event.performers)).toEqual(['VELVET', 'The Ritornello Form']);
  });
});
