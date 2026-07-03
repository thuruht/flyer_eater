import { describe, it, expect, vi } from 'vitest';
import { transcribeFlyer } from './ocr';

function fakeAi(response: string) {
  const run = vi.fn().mockResolvedValue({ response });
  return { run } as unknown as Ai;
}

describe('transcribeFlyer — token budget', () => {
  it('uses a flyer-sized token budget by default', async () => {
    const ai = fakeAi('some flyer text');
    await transcribeFlyer(ai, new ArrayBuffer(0));

    const call = (ai.run as any).mock.calls[0];
    expect(call[1].max_tokens).toBeGreaterThanOrEqual(768);
  });

  it('uses a much larger token budget when transcribing a full-month calendar image', async () => {
    const ai = fakeAi('a whole month of shows');
    await transcribeFlyer(ai, new ArrayBuffer(0), { maxTokens: 2048 });

    const call = (ai.run as any).mock.calls[0];
    expect(call[1].max_tokens).toBe(2048);
  });
});
