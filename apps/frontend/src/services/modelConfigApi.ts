import apiClient from './apiClient';

export type ModelProviderKind = 'anthropic-compatible' | 'openai-compatible' | 'gemini' | 'grok';

export type ModelTierMap = {
  fast?: string;
  balanced?: string;
  strong?: string;
};

export type ModelConfig = {
  id: string;
  name: string;
  provider: ModelProviderKind;
  baseUrl?: string;
  apiKeyPreview: string;
  models: ModelTierMap;
  isDefault: boolean;
};

export type CreateModelConfigInput = {
  name: string;
  provider: ModelProviderKind;
  baseUrl?: string;
  apiKey: string;
  models: ModelTierMap;
  isDefault: boolean;
};

export type UpdateModelConfigInput = {
  name?: string;
  provider?: ModelProviderKind;
  baseUrl?: string;
  apiKey?: string;
  models?: ModelTierMap;
  isDefault?: boolean;
};

const OWNER_ID = 'dashboard-local';

export const listModelConfigs = (): Promise<ModelConfig[]> => (
  apiClient.get(`/api/model-configs?ownerId=${OWNER_ID}`)
);

export const createModelConfig = (input: CreateModelConfigInput): Promise<ModelConfig> => (
  apiClient.post(`/api/model-configs?ownerId=${OWNER_ID}`, input)
);

export const updateModelConfig = (id: string, input: UpdateModelConfigInput): Promise<ModelConfig> => (
  apiClient.patch(`/api/model-configs/${id}?ownerId=${OWNER_ID}`, input)
);
