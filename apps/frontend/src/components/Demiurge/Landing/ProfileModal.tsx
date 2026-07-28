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
  lang: _lang,
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
    setProfileError('');
    setProfileNotice('');
    setAvatarDraft(currentUser.avatarUrl || '');
    setAvatarDraftFailed(false);
  }, [currentUser?.id, currentUser?.avatarUrl, isOpen]);

  if (!isOpen || !currentUser) return null;

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
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={translate('intake.profile.title')}
        data-surface="frosted-glass"
        className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm"
      >
        <div className="input-surface glass-panel w-full max-w-md rounded-[28px] p-6 text-zinc-100">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="type-title-3 text-white">{translate('intake.profile.title')}</h2>
              <p className="type-callout mt-3 text-zinc-300">{translate('intake.profile.description')}</p>
            </div>
            <button
              type="button"
              aria-label={translate('intake.profile.close')}
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full glass-icon-button"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-8 flex flex-col items-center text-center">
            <label className="type-title-3 group relative flex h-24 w-24 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-amber-300/35 bg-white/5 text-white shadow-[0_18px_50px_rgba(0,0,0,0.35)] transition hover:border-amber-200/70">
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
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition group-hover:opacity-100">
                <Camera className="h-6 w-6 text-white" />
              </span>
            </label>
            <div className="type-headline mt-5 max-w-full truncate text-white">
              {currentUser.displayName || profileText.displayNameFallback}
            </div>
            <div className="type-footnote mt-1 max-w-full truncate text-zinc-400">
              {currentUser.email || profileText.emailFallback}
            </div>
          </div>

          {profileError ? (
            <div className="type-footnote mt-4 rounded-2xl border border-red-400/30 bg-red-950/50 px-4 py-3 text-red-100">
              {profileError}
            </div>
          ) : null}
          {profileNotice ? (
            <div className="type-footnote mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-950/40 px-4 py-3 text-emerald-100">
              {profileNotice}
            </div>
          ) : null}

          <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-4 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="type-callout text-white">{translate('intake.profile.creditUsage')}</div>
              {creditBalance ? (
                <div className="type-footnote text-emerald-200">{creditBalance.balanceCredits} credits</div>
              ) : null}
            </div>
            {creditBalance ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                <CreditMetric label={profileText.balance} value={creditBalance.balanceCredits} tone="positive" />
                <CreditMetric label={profileText.consumed} value={creditBalance.consumedCredits} />
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex justify-between gap-3">
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              className="type-button rounded-full border border-red-300/25 px-5 py-2.5 text-red-200 transition hover:border-red-200/50 hover:bg-red-500/10"
            >
              {profileText.deleteAccount}
            </button>
            <button
              type="button"
              onClick={() => void handleFinishProfile()}
              disabled={isSavingProfile}
              className="primary-pill type-button px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSavingProfile ? profileText.saving : profileText.finish}
            </button>
          </div>
        </div>
      </div>

    </>
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
    <div className="rounded-2xl border border-white/10 bg-black/15 px-3 py-2">
      <div className="type-footnote text-zinc-500">{label}</div>
      <div className={`type-headline mt-1 truncate ${tone === 'positive' ? 'text-emerald-200' : 'text-zinc-100'}`}>
        {value}
      </div>
    </div>
  );
}

const getDisplayInitial = (value: string): string => {
  const first = Array.from(value.trim() || 'U')[0] || 'U';
  return /^[a-z]$/i.test(first) ? first.toUpperCase() : first;
};
