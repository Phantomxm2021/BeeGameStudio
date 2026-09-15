import type { McpServerScope, McpServerTransport } from '../../services/mcpServersApi';

export type PopoverAnchorRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
};

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
  autoStart: boolean;
};

export function toPopoverAnchorRect(rect: DOMRect): PopoverAnchorRect {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width };
}

export function isMcpFormSaveable(form: McpServerForm): boolean {
  return Boolean(form.name.trim()) && (form.transport === 'stdio' ? Boolean(form.command.trim()) : Boolean(form.url.trim()));
}
