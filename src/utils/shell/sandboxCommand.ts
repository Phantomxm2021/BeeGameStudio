/** Transport the already-authorized script through the sandbox's second shell
 * quoting layer without changing its bytes. shell-quote escapes ! inside its
 * double-quoted argument form, corrupting heredocs and quoted programs.
 * Decode inside the sandbox; eval retains cwd, environment and exit semantics.
 * This changes transport only, never permission checks or sandbox settings. */
export function encodeSandboxShellCommand(command: string): string {
  const encoded = Buffer.from(command, 'utf8').toString('base64')
  return `eval "$(printf %s '${encoded}' | /usr/bin/base64 --decode)"`
}

/** Quote the original script for eval without shell-quote's ! rewriting.
 * Redirect eval itself (not a string appended to the final pipeline command),
 * so the first pipeline member receives EOF and later members receive pipes. */
export function quoteSandboxCommandForEval(command: string, redirectStdin: boolean): string {
  return "'" + command.replaceAll("'", "'\"'\"'") + "'" + (redirectStdin ? ' < /dev/null' : '')
}
