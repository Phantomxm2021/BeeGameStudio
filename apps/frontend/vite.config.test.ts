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

  it('keeps the idea input surface free of default glass blur', () => {
    const cssSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src', 'index.css'), 'utf8');

    expect(cssSource).not.toContain('backdrop-filter: blur(14px)');
  });

  it('dedupes React for peer dependency UI packages', () => {
    const configSource = readFileSync(configPath, 'utf8');

    expect(configSource).toContain("dedupe: ['react', 'react-dom']");
    expect(configSource).not.toContain('@shadcn/react/message-scroller');
    expect(configSource).not.toContain("noExternal: ['@shadcn/react']");
    expect(configSource).not.toContain("inline: ['@shadcn/react']");
  });

});
