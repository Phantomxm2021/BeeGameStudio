/** The supported calculation invocation, shared by permission and write tracking.
 * This recognizes a command, not a shell program; authorization stays with callers. */
export function parseDesignCalculationCommand(command: string) {
  const prefix = /^cd (?:'([^']+)'|"([^"$`\\]+)"|([A-Za-z0-9_./-]+)) && (.+)$/.exec(command)
  const cwd = prefix ? prefix[1] ?? prefix[2] ?? prefix[3] : undefined
  const match = /^bun \.beegame\/delivery\/calculate-balance\.mjs (docs\/calc\/[A-Za-z0-9_./-]+\.(?:mjs|js)) (docs\/calc\/[A-Za-z0-9_./-]+\.md)(?: (--scenes))?$/.exec(prefix?.[4] ?? command)
  if (!match || match.slice(1, 3).some(path => path!.split('/').some(part => !part || part === '..' || part === '.'))) return
  return { model: match[1]!, output: match[2]!, scenes: Boolean(match[3]), ...(cwd ? { cwd } : {}) }
}
