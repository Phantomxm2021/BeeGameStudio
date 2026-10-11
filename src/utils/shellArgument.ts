/** Quote one literal POSIX shell argument, including quotes and newlines. */
export function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

export function remoteExecutable(path: string): string {
  // Deployment returns a home-relative path. Expand only this prefix, not
  // arbitrary user input or metacharacters embedded in the remaining path.
  return path.startsWith('~/') ? '"$HOME"/' + shellQuote(path.slice(2)) : shellQuote(path)
}
