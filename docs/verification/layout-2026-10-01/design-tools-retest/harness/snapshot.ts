import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const repo = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
const files = ['AGENTS.md', 'src/cli/print.ts', 'src/utils/messageQueueManager.ts', 'scripts/defines.ts']
async function collect(dir: string) {
  for (const entry of await readdir(join(repo, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) await collect(path)
    else if (entry.isFile()) files.push(path)
  }
}
await collect('packages/agent-workflow-server/src/beegame')
await collect('packages/scene-editor/src')
await collect('.beegame/skills/builtinskills')
const rows = []
for (const path of files.sort()) rows.push({ path, sha256: createHash('sha256').update(await readFile(join(repo, path))).digest('hex') })
for (const entry of await readdir(join(import.meta.dir, 'cli'), {withFileTypes:true})) {
  if (entry.isFile() && entry.name.endsWith('.js')) rows.push({path:'isolated-cli/'+entry.name,
    sha256:createHash('sha256').update(await readFile(join(import.meta.dir,'cli',entry.name))).digest('hex')})
}
await writeFile(join(import.meta.dir, process.argv[2] ?? 'source-before.json'), JSON.stringify(rows, null, 2))
