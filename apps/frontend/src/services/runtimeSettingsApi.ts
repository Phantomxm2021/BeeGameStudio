import apiClient from './apiClient';

export type RuntimeSettingsConfig = { resourceLibraryEnabled?: boolean };

export const getRuntimeSettings = (): Promise<RuntimeSettingsConfig> => (
  apiClient.get('/api/runtime-settings')
);

export const saveRuntimeSettings = (input: RuntimeSettingsConfig): Promise<RuntimeSettingsConfig> => (
  apiClient.put('/api/runtime-settings', input)
);
