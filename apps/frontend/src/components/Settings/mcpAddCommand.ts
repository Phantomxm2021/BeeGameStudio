type McpAddCommandResult = { name: string; url: string } | { error: 'format' | 'url' };

/** Read BGS HTTP add syntax as data. Accept upstream commands pasted from docs too. */
export function parseMcpAddCommand(input: string): McpAddCommandResult {
  const token = `(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s"'\x60]+)`;
  const match = input.trim().match(new RegExp(`^(?:bgs|codex)[ \\t]+mcp[ \\t]+add[ \\t]+(${token})[ \\t]+--url(?:[ \\t]+|=)(${token})$`));
  if (!match) return { error: 'format' };
  const unquote = (value: string) => /^["']/.test(value) ? value.slice(1, -1) : value;
  const name = unquote(match[1]);
  const url = unquote(match[2]);
  // Shell expansions and extra options cannot be represented by this form.
  if (!name.trim() || name.startsWith('-') || /[$`\\]/.test(name + url)) return { error: 'format' };
  try {
    const parsed = new URL(url);
    if (!/^https?:\/\/[^/?#]/i.test(url) || /\s/.test(url) || parsed.username || parsed.password) return { error: 'url' };
  } catch {
    return { error: 'url' };
  }
  return { name, url };
}
