import apiClient from './apiClient';

export type McpServerTransport = 'stdio' | 'sse' | 'http';
export type McpServerScope = 'beegame' | 'global' | 'project';

export type McpServerEnvVar = {
  key: string;
  value?: string;
  valuePreview?: string;
};

export type McpServerConfig = {
  id: string;
  name: string;
  enabled: boolean;
  transport: McpServerTransport;
  scope: McpServerScope;
  command?: string;
  args?: string[];
  url?: string;
  cwd?: string;
  env?: McpServerEnvVar[];
  autoStart?: boolean;
};

export type McpServerInput = Omit<McpServerConfig, 'id'> & {
  id?: string;
};

export type DiscoveredMcpServer = McpServerInput & {
  sourcePath: string;
  exists: boolean;
};

export type McpServerHealthStatus = 'available' | 'unavailable' | 'untested';

export type McpServerTestResult = {
  ok: boolean;
  status: McpServerHealthStatus;
  message: string;
  checkedAt: string;
  endpoint?: string;
  serverInfo?: {
    name?: string;
    version?: string;
  };
  capabilities?: Record<string, unknown>;
};

export type ActiveDiscoveredMcpServer = McpServerInput & {
  endpoint: string;
  exists: boolean;
  test: McpServerTestResult;
};

export const listMcpServers = (): Promise<McpServerConfig[]> => (
  apiClient.get('/api/mcp-servers', { headers: { 'Hide-Error-Toast': 'true' } })
);

export const discoverMcpServers = (): Promise<DiscoveredMcpServer[]> => (
  apiClient.get('/api/mcp-servers/discover', { headers: { 'Hide-Error-Toast': 'true' } })
);

export const importDiscoveredMcpServer = (server: DiscoveredMcpServer): Promise<McpServerConfig> => (
  apiClient.post('/api/mcp-servers', { name: server.name, sourcePath: server.sourcePath }, { headers: { 'Hide-Error-Toast': 'true' } })
);

export const discoverActiveMcpServers = (): Promise<ActiveDiscoveredMcpServer[]> => (
  apiClient.get('/api/mcp-servers/discover-active', { headers: { 'Hide-Error-Toast': 'true' } })
);

export const testMcpServer = (input: McpServerInput): Promise<McpServerTestResult> => (
  // The caller reports both protocol failures and request errors in one toast.
  apiClient.post('/api/mcp-servers/test', input, { headers: { 'Hide-Error-Toast': 'true' } })
);

export const createMcpServer = (input: McpServerInput): Promise<McpServerConfig> => (
  apiClient.post('/api/mcp-servers', input)
);

export const updateMcpServer = (id: string, input: McpServerInput): Promise<McpServerConfig> => (
  apiClient.put(`/api/mcp-servers/${encodeURIComponent(id)}`, input)
);

export const deleteMcpServer = (id: string): Promise<{ deleted: boolean }> => (
  apiClient.delete(`/api/mcp-servers/${encodeURIComponent(id)}`)
);
