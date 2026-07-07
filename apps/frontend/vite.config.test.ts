import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const configPath = join(dirname(fileURLToPath(import.meta.url)), 'vite.config.ts');

describe('vite production build config', () => {
  it('keeps standard backdrop-filter support in production CSS output', () => {
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toContain('cssTarget');
    expect(configSource).toContain('chrome111');
    expect(configSource).toContain('firefox115');
    expect(configSource).toContain('safari16');
  });

  it('defines an unprefixed backdrop-filter fallback for the idea input surface', () => {
    const cssSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src', 'index.css'), 'utf8');

    expect(cssSource).toContain('@supports (backdrop-filter: blur(1px))');
    expect(cssSource).toContain('backdrop-filter: blur(14px) saturate(120%);');
  });

  it('dedupes React for peer dependency UI packages', () => {
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toContain("dedupe: ['react', 'react-dom']");
    expect(configSource).toContain('@shadcn/react/message-scroller');
    expect(configSource).toContain("noExternal: ['@shadcn/react']");
    expect(configSource).toContain("inline: ['@shadcn/react']");
  });
});
