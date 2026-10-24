import { createRequire } from 'node:module'

for (const [source, output, format] of [
  ['../src/auth.ts', 'auth.js', 'esm'],
  ['../src/theme-bootstrap.ts', 'theme.js', 'iife'],
  ['../../frontend/src/entrypoints/portalTheme.tsx', 'theme-controls.js', 'iife'],
] as const) {
  const result = await Bun.build({
    entrypoints: [new URL(source, import.meta.url).pathname],
    outdir: new URL('../public', import.meta.url).pathname,
    naming: output,
    format,
    target: 'browser',
    minify: true,
    external: ['/auth.js'],
    plugins: [{
      name: 'shared-frontend-alias',
      setup(build) {
        build.onResolve({ filter: /^@\// }, args => ({
          path: Bun.resolveSync(new URL(`../../frontend/src/${args.path.slice(2)}`, import.meta.url).pathname, import.meta.dir),
        }))
      },
    }],
    define: {
      'import.meta.env': 'globalThis.BEEGAME_PORTAL_ENV',
      'process.env.NODE_ENV': '"production"',
    },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}
const frontendRequire = createRequire(new URL('../../frontend/package.json', import.meta.url))
const postcss = frontendRequire('postcss')
const tailwind = frontendRequire('@tailwindcss/postcss')
const cssFile = new URL('../src/account.css', import.meta.url)
const css = await postcss([tailwind()]).process(await Bun.file(cssFile).text(), { from: cssFile.pathname })
await Bun.write(new URL('../public/account.css', import.meta.url), css.css)
console.log('Built Portal authentication and shared main-site account/theme controls.')
