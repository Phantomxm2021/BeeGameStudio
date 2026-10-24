import { describe, expect, it } from 'vitest';
import { parseMcpAddCommand } from './mcpAddCommand';

describe('parseMcpAddCommand', () => {
  it.each([
    'bgs mcp add remote --url https://example.test/mcp',
    'codex mcp add remote --url https://example.test/mcp',
    '  bgs mcp add "remote" --url="https://example.test/mcp"\n',
    "bgs\tmcp add 'remote' --url 'https://example.test/mcp'",
  ])('parses the supported HTTP add command: %s', command => {
    expect(parseMcpAddCommand(command)).toEqual({ name: 'remote', url: 'https://example.test/mcp' });
  });

  it('preserves URL query parameters', () => {
    expect(parseMcpAddCommand('bgs mcp add local --url "http://127.0.0.1:3000/mcp?a=1&b=two%20words"'))
      .toEqual({ name: 'local', url: 'http://127.0.0.1:3000/mcp?a=1&b=two%20words' });
  });

  it.each([
    '', 'bgs mcp remove remote', 'bgs mcp add remote -- npx server',
    'bgs mcp add remote --url', 'bgs mcp add --url https://example.test/mcp',
    'bgs mcp add remote --url https://example.test/mcp --bearer-token-env-var TOKEN',
    'bgs mcp add remote --url https://example.test/mcp && echo done',
    'bgs mcp add remote --url https://example.test/mcp\necho done',
    'bgs mcp add remote --url "$MCP_URL"',
    'bgs mcp add remote --url "https://example.test/$(echo token)"',
    'bgs mcp add remote --url "https://example.test/mcp',
    'bgs mcp add "" --url https://example.test/mcp',
  ])('rejects incomplete or unsupported syntax: %s', command => {
    expect(parseMcpAddCommand(command)).toEqual({ error: 'format' });
  });

  it.each(['not-a-url', 'ftp://example.test/mcp', 'https:example.test', 'https:///example.test', 'https://user:password@example.test/mcp', '"https://example.test/with space"'])('rejects an unsupported URL: %s', url => {
    expect(parseMcpAddCommand(`bgs mcp add remote --url ${url}`)).toEqual({ error: 'url' });
  });
});
