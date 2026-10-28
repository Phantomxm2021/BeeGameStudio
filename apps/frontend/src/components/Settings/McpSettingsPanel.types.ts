import type { McpServerScope, McpServerTransport } from '../../services/mcpServersApi';

export type McpServerForm = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  scope: McpServerScope;
  command: string;
  argsText: string;
  url: string;
  cwd: string;
  envText: string;
  headersText: string;
  autoStart: boolean;
};

export function isMcpFormSaveable(form: McpServerForm): boolean {
  return form.transport !== 'sse' && Boolean(form.name.trim()) && (form.transport === 'stdio' ? Boolean(form.command.trim()) : Boolean(form.url.trim()));
}
