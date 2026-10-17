import apiClient from './apiClient';

export type ModelProviderKind = 'anthropic-compatible' | 'openai-compatible' | 'gemini' | 'grok';
export type ModelAuthMethod = 'platform' | 'byok' | 'claude-subscription' | 'chatgpt-subscription';

export type ModelTierMap = {
  fast?: string;
  balanced?: string;
  strong?: string;
};

export type ModelConfig = {
  published?: boolean;
  authMethods?: ModelAuthMethod[];
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl?: string;
  apiKeyPreview: string;
  models: ModelTierMap;
  isDefault: boolean;
};

export type CreateModelConfigInput = {
  published?: boolean;
  authMethods?: ModelAuthMethod[];
  name: string;
  provider: ModelProviderKind;
  baseUrl?: string;
  apiKey: string;
  models: ModelTierMap;
  isDefault: boolean;
};

export type UpdateModelConfigInput = {
  published?: boolean;
  authMethods?: ModelAuthMethod[];
  name?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  apiKey?: string;
  models?: ModelTierMap;
  isDefault?: boolean;
};

export const listModelConfigs = (): Promise<ModelConfig[]> => (
  apiClient.get('/api/model-configs')
);

export const createModelConfig = (input: CreateModelConfigInput): Promise<ModelConfig> => (
  apiClient.post('/api/model-configs', input)
);

export const updateModelConfig = (id: string, input: UpdateModelConfigInput): Promise<ModelConfig> => (
  apiClient.patch(`/api/model-configs/${encodeURIComponent(id)}`, input)
);

export const deleteModelConfig = (id: string): Promise<{ deleted: boolean }> => (
  apiClient.delete(`/api/model-configs/${encodeURIComponent(id)}`)
);

export type ModelConnectionStatus = { method: ModelAuthMethod; hasKey: boolean; disabled?: boolean; isPreferred: boolean; baseUrl?: string; models?: ModelTierMap; claudeConnected: boolean; chatgptConnected: boolean };
export type CatalogModel = ModelConfig & { connection: ModelConnectionStatus };
export type ModelLogin = { id: string; url: string; userCode?: string; method: ModelAuthMethod };
export const listModelCatalog = (): Promise<CatalogModel[]> => apiClient.get('/api/model-catalog');
export const listOpenCodeGoModels = (): Promise<import('@bee-game-studio/agent-workflow/opencode-go').OpenCodeGoModels> => apiClient.get('/api/model-catalog/opencode-go');
export const saveModelConnection = (id: string, method: ModelAuthMethod, apiKey?: string, preferred = false, byok?: { provider?: ModelProviderKind; baseUrl: string; models: ModelTierMap }): Promise<ModelConnectionStatus> => apiClient.put(`/api/model-connections/${encodeURIComponent(id)}`, { method, ...(apiKey ? { apiKey } : {}), preferred, ...(method === 'byok' && byok ? byok : {}) });
export const disconnectModelConnection = (id: string): Promise<unknown> => apiClient.delete(`/api/model-connections/${encodeURIComponent(id)}`);
export const startModelLogin = (id: string, method: ModelAuthMethod): Promise<ModelLogin> => apiClient.post(`/api/model-connections/${encodeURIComponent(id)}/login`, { method });
export const readModelLogin = (id: string): Promise<{ status: 'pending' | 'complete' | 'failed' }> => apiClient.get(`/api/model-logins/${encodeURIComponent(id)}`);
export const completeModelLogin = (id: string, code: string): Promise<unknown> => apiClient.post(`/api/model-logins/${encodeURIComponent(id)}`, { code });
export const cancelModelLogin = (id: string): Promise<unknown> => apiClient.delete(`/api/model-logins/${encodeURIComponent(id)}`);
export const disconnectModelAccount = (provider: 'claude' | 'chatgpt'): Promise<unknown> => apiClient.delete(`/api/model-accounts/${provider}`);
export type ClaudeSubscriptionUsage = { fiveHourUsedPercent?: number; sevenDayUsedPercent?: number };
export const readClaudeSubscriptionUsage = (): Promise<{ usage: ClaudeSubscriptionUsage | null }> => apiClient.get('/api/model-accounts/claude/usage');
