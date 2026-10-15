import apiClient from './apiClient';

export interface ImageGenerationSettings {
  billing?: {
    model: string;
    version: string;
    markupMultiplier: number;
    textInputUsdPerMillion: number;
    cachedTextInputUsdPerMillion: number;
    imageInputUsdPerMillion: number;
    cachedImageInputUsdPerMillion: number;
    imageOutputUsdPerMillion: number;
    fixedCreditsByVariant?: Partial<Record<`${'low' | 'medium' | 'high' | 'xhigh' | 'max'}:${'1024x1024' | '1024x1536' | '1536x1024'}`, number>>;
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
  fixedPricePresets?: Record<string, number>;
}
export const getImageGenerationSettings = (provider?: ImageGenerationSettings['provider']): Promise<ImageGenerationSettings> =>
  apiClient.get('/api/image-generation/settings' + (provider ? '?provider=' + provider : ''));
export const saveImageGenerationSettings = (
  input: Omit<ImageGenerationSettings, 'hasApiKey' | 'hasUpstreamApiKey'> & { apiKey?: string; upstreamApiKey?: string },
): Promise<ImageGenerationSettings> => apiClient.put('/api/image-generation/settings', input);

export interface PersonalImageConnection {
  source: 'platform' | 'byok';
  provider: ImageGenerationSettings['provider'];
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  hasUpstreamApiKey: boolean;
}
export const getPersonalImageConnection = (): Promise<PersonalImageConnection> =>
  apiClient.get('/api/image-generation/connection');
export const savePersonalImageConnection = (input: {
  source: PersonalImageConnection['source'];
  provider?: PersonalImageConnection['provider'];
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  upstreamApiKey?: string;
}): Promise<PersonalImageConnection> => apiClient.put('/api/image-generation/connection', input);
