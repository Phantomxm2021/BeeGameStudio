import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

describe('global CSS entry', () => {
  it('keeps imports before Tailwind directives so Vite does not discard design tokens', () => {
    const css = postcss.parse(readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8'));
    let importsEnded = false;
    const imports: string[] = [];
    for (const node of css.nodes) {
      if (node.type === 'comment') continue;
      if (node.type === 'atrule' && node.name === 'import') {
        expect(importsEnded, `Late @import ${node.params} is dropped by Vite`).toBe(false);
        imports.push(node.params);
      } else importsEnded = true;
    }
    expect(imports).toContain('"./styles/tokens.css"');
  });
});
