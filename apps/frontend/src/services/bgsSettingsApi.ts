import apiClient from './apiClient';

export type BgsSettings = { model: string; connectionKey: string; efforts: string[]; effort: string | null };
export const getBgsSettings = (): Promise<BgsSettings> => apiClient.get('/api/bgs/settings');
export const saveBgsSettings = (connectionKey: string, effort: string | null): Promise<BgsSettings> =>
  apiClient.put('/api/bgs/settings', { connectionKey, effort });
