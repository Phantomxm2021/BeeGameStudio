import { cp, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { getMacroDefines, DEFAULT_BUILD_FEATURES } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/scripts/defines.ts'

const repo = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
const outdir = join(import.meta.dir, 'cli')
await mkdir(outdir)
const result = await Bun.build({ entrypoints: [join(repo, 'src/entrypoints/cli.tsx')], outdir,
  target: 'bun', external: ['sharp'], splitting: true, sourcemap: 'linked',
  define: {...getMacroDefines(), 'process.env.NODE_ENV': JSON.stringify('production')},
  features: [...new Set([...DEFAULT_BUILD_FEATURES, ...Object.keys(process.env)
    .filter(key => key.startsWith('FEATURE_')).map(key => key.slice(8))])],
})
if (!result.success) throw Error('Isolated CLI build failed: ' + result.logs.join('\n'))
await cp(join(repo, 'vendor/audio-capture'), join(outdir, 'vendor/audio-capture'), {recursive:true})
await cp(join(repo, 'src/utils/vendor/ripgrep'), join(outdir, 'vendor/ripgrep'), {recursive:true})
await cp(join(repo, '.beegame/skills/builtinskills'), join(outdir, 'skills/builtinskills'), {recursive:true})
await symlink(join(repo, 'node_modules'), join(import.meta.dir, 'node_modules'))
console.log(JSON.stringify({isolatedBuild:outdir, outputs:result.outputs.length, diagnostics:result.logs.length}))
