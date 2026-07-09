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

export const listUserSkills = (): Promise<UserSkill[]> => (
  apiClient.get('/api/user-skills', {
    headers: {
      'Hide-Error-Toast': 'true',
    },
  })
);

export const importUserSkillPackage = (file: File): Promise<UserSkill> => {
  const formData = new FormData();
  formData.set('skill', file);
  return apiClient.post('/api/user-skills/import', formData);
};

export const updateUserSkillEnabled = (id: string, enabled: boolean): Promise<UserSkill> => (
  apiClient.put(`/api/user-skills/${encodeURIComponent(id)}/enabled`, { enabled })
);

export const deleteUserSkill = (id: string): Promise<{ deleted: boolean }> => (
  apiClient.delete(`/api/user-skills/${encodeURIComponent(id)}`)
);
