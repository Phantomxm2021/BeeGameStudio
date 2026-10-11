import { readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'
import { findGitRoot } from '../utils/git.js'

/**
 * `bee-game-studio up` — run the "# bee-game-studio up" section from the nearest CLAUDE.md.
 *
 * Walks up from CWD looking for CLAUDE.md files, extracts the section
 * under the `# bee-game-studio up` heading, and executes it as a shell script.
 *
 * ANT-only command (USER_TYPE === "ant").
 */
export async function up(): Promise<void> {
  const cwd = process.cwd()
  const gitRoot = findGitRoot(cwd)
  const searchDirs = gitRoot ? [gitRoot, cwd] : [cwd]

  let upSection: string | null = null

  for (const dir of searchDirs) {
    const claudeMdPath = join(dir, 'CLAUDE.md')
    try {
      const content = readFileSync(claudeMdPath, 'utf-8')
      upSection = extractUpSection(content)
      if (upSection) {
        console.log(`Found "# bee-game-studio up" in ${claudeMdPath}`)
        break
      }
    } catch {
      // File not found — continue searching
    }
  }

  if (!upSection) {
    console.log(
      'No "# bee-game-studio up" section found in CLAUDE.md.\n' +
        'Add a section like:\n\n' +
        '  # bee-game-studio up\n' +
        '  ```bash\n' +
        '  npm install\n' +
        '  npm run build\n' +
        '  ```',
    )
    return
  }

  console.log('Running:\n')
  console.log(upSection)
  console.log()

  const result = spawnSync('bash', ['-c', upSection], {
    cwd,
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    console.error(`\nbee-game-studio up failed with exit code ${result.status}`)
    process.exitCode = result.status ?? 1
  } else {
    console.log('\nbee-game-studio up completed successfully.')
  }
}

/**
 * Extract the content under "# bee-game-studio up" heading from markdown.
 * Returns the text between `# bee-game-studio up` and the next `#` heading (or EOF).
 * Strips fenced code block markers if present.
 */
function extractUpSection(markdown: string): string | null {
  const lines = markdown.split('\n')
  let inSection = false
  const sectionLines: string[] = []

  for (const line of lines) {
    if (/^#\s+(?:bee-game-studio|bgs|claude)\s+up\b/i.test(line)) {
      inSection = true
      continue
    }
    if (inSection && /^#\s/.test(line)) {
      break
    }
    if (inSection) {
      sectionLines.push(line)
    }
  }

  if (sectionLines.length === 0) return null

  // Strip fenced code block markers
  let text = sectionLines.join('\n').trim()
  text = text.replace(/^```\w*\n?/, '').replace(/\n?```\s*$/, '')

  return text.trim() || null
}
