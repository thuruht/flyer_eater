import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// @cf/meta/llama-3.1-8b-instruct was deprecated 2026-05-30 and fails silently
// in ai.run(), which is easy to miss because callers tend to swallow errors.
// This guards against any call site regressing to the bare (non -fp8) name.
describe('no calls to the deprecated llama-3.1-8b-instruct model', () => {
  const srcDir = __dirname;
  const tsFiles = readdirSync(srcDir).filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts'));

  for (const file of tsFiles) {
    it(`${file} does not reference the deprecated model id`, () => {
      const contents = readFileSync(join(srcDir, file), 'utf-8');
      const bareReferences = contents.match(/@cf\/meta\/llama-3\.1-8b-instruct(?!-fp8)/g);
      expect(bareReferences).toBeNull();
    });
  }
});
