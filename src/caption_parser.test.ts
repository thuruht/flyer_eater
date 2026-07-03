import { describe, it, expect } from 'vitest';
import { parseCaption } from './caption_parser';

describe('parseCaption performer extraction — version/revision tokens', () => {
  it('does not treat a version marker as a performer', () => {
    const result = parseCaption('07.23.26 Howdy V2');
    expect(result.performers).toBeUndefined();
  });

  it('strips "pt 2" from a caption with real performers', () => {
    const result = parseCaption('Dry Rot + Gag pt 2, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
  });

  it('strips "repost" from a caption with real performers', () => {
    const result = parseCaption('repost: Dry Rot + Gag, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
  });

  it('strips "v3" from a caption with real performers', () => {
    const result = parseCaption('Dry Rot + Gag v3, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
  });

  it('does not treat a bare "update" caption as a performer', () => {
    const result = parseCaption('UPDATE - Howdy 8/6');
    expect(result.performers).toBeUndefined();
  });

  it('strips "update" from a caption with real performers', () => {
    const result = parseCaption('UPDATE: Dry Rot + Gag, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
  });
});

describe('parseCaption price extraction — dollar amounts must survive', () => {
  it('preserves a dollar range on its own', () => {
    const result = parseCaption('Show at Farewell, $10-15');
    expect(result.price).toBe('$10-15');
  });

  it('preserves a dollar range alongside PWYC', () => {
    const result = parseCaption('Show at Farewell, $10-15 pwyc');
    expect(result.price).toBe('PWYC ($10-15)');
  });

  it('still handles a single dollar minimum with PWYC (existing behavior)', () => {
    const result = parseCaption('Show at Farewell, pwyc $5 minimum');
    expect(result.price).toBe('PWYC / $5 minimum');
  });

  it('does not leak the range into performers when both are present', () => {
    const result = parseCaption('Dry Rot + Gag, $10-15 pwyc, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
  });

  it('does not leak a range outside 1-12 into performers as a fake name', () => {
    const result = parseCaption('Dry Rot + Gag, $20-25 pwyc, Jan 15 at Farewell');
    expect(result.performers).toEqual(['Dry Rot', 'Gag']);
    expect(result.price).toBe('PWYC ($20-25)');
  });
});
