type McpAddCommandResult = { name: string; url: string } | { name: string; command: string; args: string[] } | { error: 'format' | 'url' };

/** Parse pasted add commands as configuration data, never as a shell program. */
export function parseMcpAddCommand(input: string): McpAddCommandResult {
  const source = input.trim();
  if (/[\r\n$`\\]/.test(source)) return { error: 'format' };
  const pattern = /--url=(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+)|"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/gy;
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(source);
    if (!match) return { error: 'format' };
    tokens.push(match[0]);
    offset = pattern.lastIndex;
    if (offset < source.length && !/[ \t]/.test(source[offset])) return { error: 'format' };
    while (/[ \t]/.test(source[offset] ?? '') && offset < source.length) offset++;
  }
  const unquote = (value: string) => /^["']/.test(value) ? value.slice(1, -1) : value;
  if (!['bgs', 'codex'].includes(tokens[0]) || tokens[1] !== 'mcp' || tokens[2] !== 'add' || tokens.length < 5) return { error: 'format' };
  const name = unquote(tokens[3]);
  if (!name.trim() || name.startsWith('-')) return { error: 'format' };
  const rest = tokens.slice(4);
  if (rest[0] === '--url' || rest[0].startsWith('--url=')) {
    let value: string;
    if (rest[0] === '--url') {
      if (rest.length !== 2) return { error: 'format' };
      value = rest[1];
    } else {
      if (rest.length !== 1) return { error: 'format' };
      value = rest[0].slice('--url='.length);
    }
    const url = unquote(value);
    try {
      const parsed = new URL(url);
      if (!/^https?:\/\/[^/?#]/i.test(url) || /\s/.test(url) || parsed.username || parsed.password) return { error: 'url' };
    } catch {
      return { error: 'url' };
    }
    return { name, url };
  }
  if (rest[0] === '--') rest.shift();
  const command = rest[0] && unquote(rest[0]);
  if (!command?.trim() || command.startsWith('-') || tokens.some(token => !/^["']/.test(token) && /[;&|<>()]/.test(token))) return { error: 'format' };
  return { name, command, args: rest.slice(1).map(unquote) };
}
