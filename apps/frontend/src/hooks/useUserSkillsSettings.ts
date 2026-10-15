import { useState } from 'react';
import { useSettingsSectionLoad } from './useSettingsSectionLoad';
import { useToastContext } from '../contexts/ToastContext';
import {
  deleteUserSkill,
  importUserSkillPackage,
  listUserSkills,
  updateUserSkillEnabled,
  type UserSkill,
} from '../services/userSkillsApi';

type UserSkillFeedback = {
  importFailed: string;
  imported: (name: string) => string;
  saveFailed: string;
  deleteFailed: string;
  deleted: string;
  unavailable: string;
};

// The settings view owns when this section is visible; this hook owns its
// server data and edits. Other settings no longer reload the skills list.
export function useUserSkillsSettings({ isOpen, allowed, selected, userId, copy }: {
  isOpen: boolean;
  allowed: boolean;
  selected: boolean;
  userId: string | undefined;
  copy: UserSkillFeedback;
}) {
  const { showError, showSuccess } = useToastContext();
  const [userSkills, setUserSkills] = useState<UserSkill[]>([]);
  const [isSavingUserSkill, setIsSavingUserSkill] = useState(false);

  const loading = useSettingsSectionLoad({ isOpen, allowed, selected, userId,
    load: isCurrent => {
      return listUserSkills()
        .then(skills => {
          if (isCurrent()) setUserSkills(uniqueUserSkills(skills));
        })
        .catch(error => {
          if (isCurrent()) {
            setUserSkills([]);
            showError(error instanceof Error ? error.message : copy.unavailable);
          }
        });
    },
  });

  const handleImportUserSkill = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      showError(copy.importFailed);
      return;
    }
    setIsSavingUserSkill(true);
    try {
      const saved = await importUserSkillPackage(file);
      setUserSkills(current => uniqueUserSkills([saved, ...current.filter(skill => skill.id !== saved.id)]));
      showSuccess(copy.imported(file.name));
    } catch (error) {
      showError(error instanceof Error ? error.message : copy.importFailed);
    } finally {
      setIsSavingUserSkill(false);
    }
  };

  const handleToggleUserSkill = async (skill: UserSkill) => {
    setIsSavingUserSkill(true);
    try {
      const saved = await updateUserSkillEnabled(skill.id, !skill.enabled);
      setUserSkills(current => uniqueUserSkills(current.map(item => (item.id === saved.id ? saved : item))));
    } catch (error) {
      showError(error instanceof Error ? error.message : copy.saveFailed);
    } finally {
      setIsSavingUserSkill(false);
    }
  };

  const handleDeleteUserSkill = async (skill: UserSkill) => {
    setIsSavingUserSkill(true);
    try {
      await deleteUserSkill(skill.id);
      setUserSkills(current => current.filter(item => item.id !== skill.id));
      showSuccess(copy.deleted);
    } catch (error) {
      showError(error instanceof Error ? error.message : copy.deleteFailed);
    } finally {
      setIsSavingUserSkill(false);
    }
  };

  return { userSkills, loading, isSavingUserSkill, handleImportUserSkill, handleToggleUserSkill, handleDeleteUserSkill };
}

function uniqueUserSkills(skills: UserSkill[]): UserSkill[] {
  const seen = new Set<string>();
  const unique: UserSkill[] = [];
  for (const skill of skills) {
    const key = skill.slug || skill.name;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(skill);
  }
  return unique.sort((left, right) => left.name.localeCompare(right.name));
}
