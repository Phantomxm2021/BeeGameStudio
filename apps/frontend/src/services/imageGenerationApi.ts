import apiClient from './apiClient';

export interface ImageGenerationSettings {
  billing?: {
    model: string;
    version: string;
    creditsPerUsd?: number;
    textInputCreditsPerMillion: number;
    imageInputCreditsPerMillion: number;
    textOutputCreditsPerMillion: number;
    imageOutputCreditsPerMillion: number;
    maxRequestCredits: number;
    projectBudgetCredits: number;
  } | null;
  provider: 'openai' | 'openrouter' | 'vercel' | 'cloudflare';
  baseUrl: string;
  model: string;
  quality: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  size: string;
  hasApiKey: boolean;
  hasUpstreamApiKey?: boolean;
}
export const getImageGenerationSettings = (provider?: ImageGenerationSettings['provider']): Promise<ImageGenerationSettings> =>
  apiClient.get('/api/image-generation/settings' + (provider ? '?provider=' + provider : ''));
export const saveImageGenerationSettings = (
  input: Omit<ImageGenerationSettings, 'hasApiKey' | 'hasUpstreamApiKey'> & { apiKey?: string; upstreamApiKey?: string },
): Promise<ImageGenerationSettings> => apiClient.put('/api/image-generation/settings', input);
