import apiClient from './apiClient';

export type WebSearchAdapter = 'tavily' | 'api' | 'bing' | 'brave' | 'exa';
export type WebFetchAdapter = 'tavily' | 'http';

export type WebToolsConfig = {
  webSearchAdapter?: WebSearchAdapter;
  webFetchAdapter?: WebFetchAdapter;
  braveApiKeyPreview?: string;
  braveApiKey?: string;
  exaApiKeyPreview?: string;
  exaApiKey?: string;
};

export const getWebToolsConfig = (): Promise<WebToolsConfig> => (
  apiClient.get('/api/web-tools')
);

export const saveWebToolsConfig = (input: WebToolsConfig): Promise<WebToolsConfig> => (
  apiClient.put('/api/web-tools', input)
);
