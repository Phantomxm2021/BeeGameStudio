import apiClient from './apiClient';

export type RuntimeSettingsConfig = {
  autoMemoryEnabled?: boolean;
  autoDreamEnabled?: boolean;
  skillSearchEnabled?: boolean;
  treeSitterBashEnabled?: boolean;
  webBrowserToolEnabled?: boolean;
  bashClassifierEnabled?: boolean;
  mcpSkillsEnabled?: boolean;
};

export const getRuntimeSettings = (): Promise<RuntimeSettingsConfig> => (
  apiClient.get('/api/runtime-settings')
);

export const saveRuntimeSettings = (input: RuntimeSettingsConfig): Promise<RuntimeSettingsConfig> => (
  apiClient.put('/api/runtime-settings', input)
);
