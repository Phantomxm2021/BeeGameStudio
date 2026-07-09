import apiClient from './apiClient';

export type UserSkillReference = {
  path: string;
  content: string;
};

export type UserSkill = {
  id: string;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  content: string;
  references: UserSkillReference[];
  createdAt: string;
  updatedAt: string;
};

export type UserSkillInput = {
  id?: string;
  enabled?: boolean;
  content: string;
  references?: UserSkillReference[];
};

export const listUserSkills = (): Promise<UserSkill[]> => (
  apiClient.get('/api/user-skills')
);

export const createUserSkill = (input: UserSkillInput): Promise<UserSkill> => (
  apiClient.post('/api/user-skills', input)
);

export const updateUserSkill = (id: string, input: UserSkillInput): Promise<UserSkill> => (
  apiClient.put(`/api/user-skills/${encodeURIComponent(id)}`, input)
);

export const deleteUserSkill = (id: string): Promise<{ deleted: boolean }> => (
  apiClient.delete(`/api/user-skills/${encodeURIComponent(id)}`)
);
