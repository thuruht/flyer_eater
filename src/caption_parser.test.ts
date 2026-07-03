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
