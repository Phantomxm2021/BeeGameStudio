import { X } from 'lucide-react';
import type { SupabaseOAuthProvider } from '../../../services/supabaseAuthApi';
import type { AuthMode, IntakeCopy, Translate } from './types';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog';
import { Checkbox } from '../../beui/registry/components/motion/checkbox';

type AuthDialogProps = {
  isOpen: boolean;
  authMode: AuthMode;
  isInvitationRequired: boolean;
  loginEmail: string;
  loginPassword: string;
  registerDisplayName: string;
  invitationCode: string;
  hasAcceptedTerms: boolean;
  isSigningIn: boolean;
  intakeText: IntakeCopy;
  translate: Translate;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
  onAuthModeChange: (mode: AuthMode) => void;
  onResetFeedback: () => void;
  onLoginEmailChange: (value: string) => void;
  onLoginPasswordChange: (value: string) => void;
  onRegisterDisplayNameChange: (value: string) => void;
  onInvitationCodeChange: (value: string) => void;
  onTermsChange: (value: boolean) => void;
  onOpenLegalDocument: (kind: 'terms' | 'privacy') => void;
  onOAuthSignIn: (provider: SupabaseOAuthProvider) => void | Promise<void>;
}

export function AuthDialog({
  isOpen,
  authMode,
  isInvitationRequired,
  loginEmail,
  loginPassword,
  registerDisplayName,
  invitationCode,
  hasAcceptedTerms,
  isSigningIn,
  intakeText,
  translate,
  onSubmit,
  onClose,
  onAuthModeChange,
  onResetFeedback,
  onLoginEmailChange,
  onLoginPasswordChange,
  onRegisterDisplayNameChange,
  onInvitationCodeChange,
  onTermsChange,
  onOpenLegalDocument,
  onOAuthSignIn,
}: AuthDialogProps) {
  const mode = authMode === 'resetPassword' ? 'resetPassword' : authMode;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent aria-label={translate('intake.auth.dialogLabel')} className="max-w-[520px] p-0">
        <form onSubmit={onSubmit} className="flex max-h-[calc(100dvh-2rem)] max-w-[520px] flex-col overflow-y-auto p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogTitle>
              {translate(`intake.auth.title.${mode}`)}
            </DialogTitle>
            <p className="mt-2 text-sm leading-5 text-muted-foreground">
              {translate(`intake.auth.description.${mode}`)}
            </p>
          </div>
          <button
            type="button"
            aria-label={translate('intake.auth.close')}
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {authMode !== 'resetPassword' ? (
          <div className="mt-5 grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1">
            {(['login', 'register'] as const).map(nextMode => (
              <button
                key={nextMode}
                type="button"
                onClick={() => {
                  onAuthModeChange(nextMode);
                  onResetFeedback();
                }}
                className={`h-9 rounded-md px-3 text-sm font-medium transition ${authMode === nextMode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
              >
                {translate(`intake.auth.tabs.${nextMode}`)}
              </button>
            ))}
          </div>
        ) : null}

        <div className={authMode === 'register' ? 'mt-6 space-y-4' : 'mt-5 space-y-3'}>
          {authMode === 'register' ? (
            <label className="block text-sm text-muted-foreground">
              {translate('intake.auth.fields.displayName')}
              <input
                aria-label={translate('intake.auth.fields.displayNameAria')}
                type="text"
                value={registerDisplayName}
                onChange={event => onRegisterDisplayNameChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
                autoComplete="nickname"
                placeholder={translate('intake.auth.fields.displayNamePlaceholder')}
              />
            </label>
          ) : null}
          <label className="block text-sm text-muted-foreground">
            {translate('intake.auth.fields.email')}
            <input
              aria-label={translate('intake.auth.fields.emailAria')}
              type="email"
              value={loginEmail}
              onChange={event => onLoginEmailChange(event.target.value)}
              className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
              autoComplete="email"
              placeholder="you@example.com"
            />
          </label>
          {isInvitationRequired && authMode === 'register' ? (
            <label className="block text-sm text-muted-foreground">
              {translate('intake.auth.fields.invitationCode')}
              <input
                aria-label={translate('intake.auth.fields.invitationCodeAria')}
                type="text"
                value={invitationCode}
                onChange={event => onInvitationCodeChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
                autoComplete="off"
                placeholder={translate('intake.auth.fields.invitationCodePlaceholder')}
              />
            </label>
          ) : null}
          {authMode !== 'resetPassword' ? (
            <label className="block text-sm text-muted-foreground">
              {translate('intake.auth.fields.password')}
              <input
                aria-label={translate('intake.auth.fields.passwordAria')}
                type="password"
                value={loginPassword}
                onChange={event => onLoginPasswordChange(event.target.value)}
                className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
                autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                placeholder={
                  authMode === 'register'
                    ? translate('intake.auth.fields.passwordNewPlaceholder')
                    : translate('intake.auth.fields.passwordPlaceholder')
                }
              />
            </label>
          ) : null}
          {authMode === 'login' ? (
            <button
              type="button"
              onClick={() => {
                onAuthModeChange('resetPassword');
                onResetFeedback();
              }}
              disabled={isSigningIn}
            className="mx-auto block text-center text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-60"
            >
              {intakeText.auth.forgotPassword}
            </button>
          ) : (
            <div className="flex items-start gap-3 rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
              <Checkbox aria-label={intakeText.auth.acceptTermsAria} checked={hasAcceptedTerms} onCheckedChange={onTermsChange} className="mt-0.5" />
              <span>
                {intakeText.auth.acceptTermsPrefix}{' '}
                <button
                  type="button"
                  onClick={() => onOpenLegalDocument('terms')}
                  className="text-primary underline underline-offset-4"
                >
                  {intakeText.auth.termsLabel}
                </button>{' '}
                {intakeText.auth.acceptTermsConnector}{' '}
                <button
                  type="button"
                  onClick={() => onOpenLegalDocument('privacy')}
                  className="text-primary underline underline-offset-4"
                >
                  {intakeText.auth.privacyLabel}
                </button>
                {intakeText.auth.acceptTermsSuffix}
              </span>
            </div>
          )}
        </div>

        {authMode === 'login' ? (
          <button
            type="submit"
            disabled={isSigningIn}
            className="mt-5 h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningIn ? intakeText.auth.signingIn : intakeText.auth.signInAndContinue}
          </button>
        ) : null}

        {authMode === 'login' ? (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>{intakeText.auth.oauthDivider}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {isInvitationRequired ? (
              <input
                aria-label={translate('intake.auth.fields.oauthInvitationCodeAria')}
                type="text"
                value={invitationCode}
                onChange={event => onInvitationCodeChange(event.target.value)}
                className="mb-3 h-10 w-full rounded-lg border border-input bg-background px-3 type-input text-foreground outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30 min-[900px]:text-md"
                autoComplete="off"
                placeholder={translate('intake.auth.fields.invitationCodePlaceholder')}
              />
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <OAuthButton provider="github" label="GitHub" onClick={onOAuthSignIn} />
              <OAuthButton provider="google" label="Google" onClick={onOAuthSignIn} />
              <OAuthButton provider="facebook" label="Facebook" onClick={onOAuthSignIn} />
              <OAuthButton provider="x" label="X" onClick={onOAuthSignIn} iconOnly />
              <OAuthButton provider="discord" label="Discord" onClick={onOAuthSignIn} wide />
            </div>
          </>
        ) : null}

        {authMode !== 'login' ? <div className="mt-6 flex flex-col-reverse items-stretch gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
          {authMode === 'resetPassword' ? (
            <button
              type="button"
              onClick={() => {
                onAuthModeChange('login');
                onResetFeedback();
              }}
              className="h-9 rounded-lg border border-border px-4 text-sm font-medium text-foreground transition hover:bg-accent"
            >
              {intakeText.actions.backToLogin}
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isSigningIn}
            className="h-9 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSigningIn
              ? intakeText.auth.signingIn
              : authMode === 'resetPassword'
                ? intakeText.auth.sendReset
                : authMode === 'register'
                  ? intakeText.auth.registerAndContinue
                  : intakeText.auth.signInAndContinue}
          </button>
        </div> : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OAuthButton({
  provider,
  label,
  onClick,
  wide = false,
  iconOnly = false,
}: {
  provider: SupabaseOAuthProvider;
  label: string;
  onClick: (provider: SupabaseOAuthProvider) => void | Promise<void>;
  wide?: boolean;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void onClick(provider)}
      className={`inline-flex h-9 items-center justify-center rounded-lg border border-border bg-background px-3 text-sm text-foreground transition hover:bg-accent ${iconOnly ? 'gap-0' : 'gap-2'} ${wide ? 'sm:col-span-2' : ''}`}
    >
      <OAuthProviderIcon provider={provider} />
      {iconOnly ? <span className="sr-only">{label}</span> : <span>{label}</span>}
    </button>
  );
}

function OAuthProviderIcon({ provider }: { provider: SupabaseOAuthProvider }) {
  if (provider === 'github') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
        <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
      </svg>
    );
  }
  if (provider === 'google') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]">
        <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.53-.2-2.27H12v4.29h6.47a5.54 5.54 0 0 1-2.4 3.63v2.96h3.88c2.27-2.09 3.54-5.17 3.54-8.61Z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-2.96c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.05A12 12 0 0 0 12 24Z" />
        <path fill="#FBBC05" d="M5.27 14.33a7.2 7.2 0 0 1 0-4.66V6.62H1.26a12 12 0 0 0 0 10.76l4.01-3.05Z" />
        <path fill="#EA4335" d="M12 4.72c1.76 0 3.34.61 4.58 1.79l3.44-3.44A11.55 11.55 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4.01 3.05C6.22 6.83 8.87 4.72 12 4.72Z" />
      </svg>
    );
  }
  if (provider === 'facebook') {
    return <span aria-hidden="true" className="text-base font-semibold text-[#1877F2]">f</span>;
  }
  if (provider === 'x') {
    return <span aria-hidden="true" className="text-sm font-semibold">𝕏</span>;
  }
  return <span aria-hidden="true" className="text-sm font-semibold text-[#5865F2]">◉</span>;
}
