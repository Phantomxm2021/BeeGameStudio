import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
const repo = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
const files = ['dist/cli-bun.js', 'AGENTS.md']
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
await writeFile(join(import.meta.dir, process.argv[2] ?? 'source-before.json'), JSON.stringify(rows, null, 2))
