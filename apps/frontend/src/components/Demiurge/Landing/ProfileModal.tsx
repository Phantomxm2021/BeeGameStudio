import { type ChangeEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, X } from 'lucide-react';
import type { Language } from '../AgentsConfig';
import {
  clearSupabaseSession,
  updateSupabaseAvatarUrl,
  uploadSupabaseAvatarImage,
} from '../../../services/supabaseAuthApi';
import { deleteCurrentUser } from '../../../services/currentUserApi';
import type { BeeGameCreditBalance } from '../../../services/creditsApi';
import { Button } from '../../beui/project-button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../ui/dialog';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ProfileModalUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

type ProfileCreditBalance = Pick<BeeGameCreditBalance, 'balanceCredits' | 'consumedCredits'>;

interface ProfileModalProps {
  isOpen: boolean;
  lang: Language;
  currentUser: ProfileModalUser | null | undefined;
  creditBalance: ProfileCreditBalance | null;
  onClose: () => void;
  onUserChanged: () => void | Promise<void>;
}

export function ProfileModal({
  isOpen,
  currentUser,
  creditBalance,
  onClose,
  onUserChanged,
}: ProfileModalProps) {
  const { t: translate } = useTranslation();
  const profileText = getProfileText(translate);
  const [avatarDraft, setAvatarDraft] = useState('');
  const [avatarDraftFailed, setAvatarDraftFailed] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [profileNotice, setProfileNotice] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    if (!isOpen || !currentUser) return;
    // Rehydrate editable fields whenever a profile session opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProfileError('');
    setProfileNotice('');
    setAvatarDraft(currentUser.avatarUrl || '');
    setAvatarDraftFailed(false);
  }, [currentUser, isOpen]);

  if (!currentUser) return null;

  const handleAvatarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setAvatarDraftFailed(false);
    setProfileError('');
    setProfileNotice('');
    if (!file.type.startsWith('image/')) {
      setProfileError(translate('intake.errors.profileImageRequired'));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setProfileError(translate('intake.errors.profileImageTooLarge'));
      return;
    }
    setIsSavingProfile(true);
    void uploadSupabaseAvatarImage(file)
      .then(url => {
        setAvatarDraft(url);
        setProfileNotice(translate('intake.errors.profileAvatarSelected'));
      })
      .catch(error => {
        setProfileError(error instanceof Error ? error.message : translate('intake.errors.profileAvatarUploadFailed'));
      })
      .finally(() => setIsSavingProfile(false));
  };

  const handleFinishProfile = async () => {
    if (isSavingProfile) return;
    const nextAvatar = avatarDraft.trim();
    const currentAvatar = currentUser.avatarUrl || '';
    if (!nextAvatar || nextAvatar === currentAvatar) {
      onClose();
      return;
    }
    setProfileError('');
    setProfileNotice('');
    setIsSavingProfile(true);
    try {
      await updateSupabaseAvatarUrl(nextAvatar);
      await onUserChanged();
      onClose();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : translate('intake.errors.profileAvatarUpdateFailed'));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDeleteAccount = async () => {
    setProfileError('');
    setProfileNotice('');
    const confirmed = window.confirm(profileText.deleteConfirm);
    if (!confirmed) return;
    try {
      await deleteCurrentUser();
      clearSupabaseSession();
      onClose();
      await onUserChanged();
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : profileText.deleteFailed);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="type-title-3 text-foreground">{translate('intake.profile.title')}</DialogTitle>
              <DialogDescription className="type-callout mt-3 text-foreground">{translate('intake.profile.description')}</DialogDescription>
            </div>
            <button
              type="button"
              aria-label={translate('intake.profile.close')}
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full grid place-items-center border border-border bg-background"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-8 flex flex-col items-center text-center">
            <label className="type-title-3 group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[var(--border-strong)] bg-muted text-foreground shadow-lg transition hover:border-[var(--ring)]">
              {avatarDraft && !avatarDraftFailed ? (
                <img
                  src={avatarDraft}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-cover"
                  onLoad={() => setAvatarDraftFailed(false)}
                  onError={() => setAvatarDraftFailed(true)}
                />
              ) : (
                getDisplayInitial(currentUser.displayName || currentUser.email || currentUser.id)
              )}
              <input
                aria-label={translate('intake.profile.uploadAvatar')}
                type="file"
                accept="image/*"
                onChange={handleAvatarFileChange}
                className="sr-only"
              />
              <span className="absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 transition group-hover:opacity-100">
                <Camera className="h-6 w-6 text-foreground" />
              </span>
            </label>
            <div className="type-headline mt-5 max-w-full truncate text-foreground">
              {currentUser.displayName || profileText.displayNameFallback}
            </div>
            <div className="type-footnote mt-1 max-w-full truncate text-muted-foreground">
              {currentUser.email || profileText.emailFallback}
            </div>
          </div>

          {profileError ? (
            <div className="type-footnote mt-4 rounded-lg border border-[var(--destructive)] bg-[var(--surface-2)] px-4 py-3 text-[var(--destructive)]">
              {profileError}
            </div>
          ) : null}
          {profileNotice ? (
            <div className="type-footnote mt-4 rounded-lg border border-[var(--success)] bg-[var(--surface-2)] px-4 py-3 text-[var(--success)]">
              {profileNotice}
            </div>
          ) : null}

          <div className="mt-6 rounded-lg border border-border bg-muted/40 p-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="type-callout text-foreground">{translate('intake.profile.creditUsage')}</div>
              {creditBalance ? (
                <div className="type-footnote text-[var(--text-secondary)]">{creditBalance.balanceCredits} credits</div>
              ) : null}
            </div>
            {creditBalance ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <CreditMetric label={profileText.balance} value={creditBalance.balanceCredits} />
                <CreditMetric label={profileText.consumed} value={creditBalance.consumedCredits} />
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex justify-between gap-3">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => void handleDeleteAccount()}
            >
              {profileText.deleteAccount}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleFinishProfile()}
              disabled={isSavingProfile}
            >
              {isSavingProfile ? profileText.saving : profileText.finish}
            </Button>
          </div>
      </DialogContent>
    </Dialog>
  );
}

function getProfileText(translate: Translate) {
  return {
    displayNameFallback: translate('intake.profile.displayNameFallback'),
    emailFallback: translate('intake.profile.emailFallback'),
    balance: translate('intake.profile.balance'),
    consumed: translate('intake.profile.consumed'),
    deleteAccount: translate('intake.profile.deleteAccount'),
    deleteConfirm: translate('intake.profile.deleteConfirm'),
    deleteFailed: translate('intake.profile.deleteFailed'),
    finish: translate('intake.profile.finish'),
    saving: translate('intake.profile.saving'),
  };
}

function CreditMetric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  tone?: 'neutral' | 'positive';
}) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <div className="type-footnote text-muted-foreground">{label}</div>
      <div className={`type-headline mt-1 truncate ${tone === 'positive' ? 'text-[var(--success)]' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

const getDisplayInitial = (value: string): string => {
  const first = Array.from(value.trim() || 'U')[0] || 'U';
  return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
