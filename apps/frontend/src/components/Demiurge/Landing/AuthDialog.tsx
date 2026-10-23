import { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, AtSign, Eye, EyeOff, Gamepad2, LoaderCircle, LockKeyhole, ShieldCheck, Ticket, UserRound, X } from 'lucide-react';
import type { SupabaseOAuthProvider } from '../../../services/supabaseAuthApi';
import type { AuthMode, IntakeCopy, Translate } from './types';
import { Dialog, DialogContent, DialogTitle } from '../../ui/dialog';
import { Button } from '../../beui/project-button';
import { Checkbox } from '../../beui/registry/components/motion/checkbox';
import { Input } from '../../beui/registry/components/motion/input';

type AuthDialogProps = {
  isOpen: boolean;
  authMode: AuthMode;
  isInvitationRequired: boolean;
  loginEmail: string;
  loginPassword: string;
  registerDisplayName: string;
  invitationCode: string;
  emailVerificationCode: string;
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
  onEmailVerificationCodeChange: (value: string) => void;
  onResendEmailCode: () => void | Promise<void>;
  onTermsChange: (value: boolean) => void;
  onOpenLegalDocument: (kind: 'terms' | 'privacy') => void;
  onOAuthSignIn: (provider: SupabaseOAuthProvider) => void | Promise<void>;
};

export function AuthDialog({
  isOpen, authMode, isInvitationRequired, loginEmail, loginPassword, registerDisplayName,
  invitationCode, emailVerificationCode, hasAcceptedTerms, isSigningIn, intakeText,
  translate, onSubmit, onClose, onAuthModeChange, onResetFeedback, onLoginEmailChange,
  onLoginPasswordChange, onRegisterDisplayNameChange, onInvitationCodeChange,
  onEmailVerificationCodeChange, onResendEmailCode, onTermsChange, onOpenLegalDocument,
  onOAuthSignIn,
}: AuthDialogProps) {
  const [showPassword, setShowPassword] = useState(false);
  const reducedMotion = useReducedMotion();
  const title = translate(`intake.auth.title.${authMode}`);
  const changeMode = (mode: AuthMode) => {
    setShowPassword(false);
    onAuthModeChange(mode);
    onResetFeedback();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent aria-label={translate('intake.auth.dialogLabel')} className="h-[660px] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[520px] overflow-hidden rounded-2xl border-border bg-popover p-0 shadow-2xl">
        <form onSubmit={onSubmit} className="flex h-full min-h-0 max-h-[calc(100dvh-2rem)] max-w-[520px] flex-col overflow-y-auto p-6 sm:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-2xl font-semibold tracking-tight">{title}</DialogTitle>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {translate(`intake.auth.description.${authMode}`)}
              </p>
              {authMode === 'verifyEmail' ? <p className="mt-1 break-all text-sm font-medium text-foreground">{loginEmail}</p> : null}
            </div>
            <Button type="button" variant="outline" size="icon-sm" aria-label={translate('intake.auth.close')} onClick={onClose} className="size-9 shrink-0 rounded-full">
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>

          {authMode === 'login' || authMode === 'register' ? (
            <div className="mt-7 grid grid-cols-2 rounded-xl border border-border bg-muted/60 p-1">
              {(['login', 'register'] as const).map(nextMode => (
                <Button key={nextMode} type="button" variant="ghost" size="sm" aria-pressed={authMode === nextMode}
                  onClick={() => changeMode(nextMode)}
                  className={`relative h-9 rounded-lg text-sm ${authMode === nextMode ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {authMode === nextMode ? <motion.span layoutId="auth-mode-active" aria-hidden="true"
                    transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 360, damping: 32 }}
                    className="absolute inset-0 rounded-lg border border-border bg-background shadow-sm" /> : null}
                  <span className="relative">{translate(`intake.auth.tabs.${nextMode}`)}</span>
                </Button>
              ))}
            </div>
          ) : null}

            <motion.div
              key={authMode}
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="mt-6 space-y-4"
            >
              {authMode === 'register' ? (
                <Input label={translate('intake.auth.fields.displayName')} type="text" value={registerDisplayName}
                  onChange={onRegisterDisplayNameChange} autoComplete="nickname" disabled={isSigningIn}
                  placeholder={translate('intake.auth.fields.displayNamePlaceholder')} leftIcon={<UserRound />}
                  classNames={{ field: 'rounded-xl bg-background' }} />
              ) : null}

              {authMode !== 'verifyEmail' ? (
                <Input label={translate('intake.auth.fields.email')} type="email" value={loginEmail}
                  onChange={onLoginEmailChange} autoComplete="email" disabled={isSigningIn}
                  placeholder="you@example.com" leftIcon={<AtSign />}
                  classNames={{ field: 'rounded-xl bg-background' }} />
              ) : (
                <Input label={translate('intake.auth.fields.verificationCode')} type="text" value={emailVerificationCode}
                  onChange={value => onEmailVerificationCodeChange(value.replace(/\D/g, '').slice(0, 8))}
                  autoComplete="one-time-code" inputMode="numeric" maxLength={8} disabled={isSigningIn}
                  placeholder={translate('intake.auth.fields.verificationCodePlaceholder')} leftIcon={<ShieldCheck />}
                  classNames={{ field: 'rounded-xl bg-background', input: 'tracking-[0.18em]' }} />
              )}

              {authMode === 'login' || authMode === 'register' ? (
                <Input label={translate('intake.auth.fields.password')} type={showPassword ? 'text' : 'password'}
                  value={loginPassword} onChange={onLoginPasswordChange} disabled={isSigningIn}
                  autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                  placeholder={translate(authMode === 'register' ? 'intake.auth.fields.passwordNewPlaceholder' : 'intake.auth.fields.passwordPlaceholder')}
                  leftIcon={<LockKeyhole />}
                  rightIcon={<button type="button" aria-label={translate(showPassword ? 'intake.auth.hidePassword' : 'intake.auth.showPassword')}
                    onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff /> : <Eye />}</button>}
                  classNames={{ field: 'rounded-xl bg-background' }} />
              ) : null}

              {isInvitationRequired && authMode === 'register' ? (
                <Input label={translate('intake.auth.fields.invitationCode')} type="text" value={invitationCode}
                  onChange={onInvitationCodeChange} autoComplete="off" disabled={isSigningIn}
                  placeholder={translate('intake.auth.fields.invitationCodePlaceholder')} leftIcon={<Ticket />}
                  classNames={{ field: 'rounded-xl bg-background' }} />
              ) : null}

              {authMode === 'login' ? (
                <div className="flex justify-end">
                  <button type="button" disabled={isSigningIn} onClick={() => changeMode('resetPassword')} className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                    {intakeText.auth.forgotPassword}
                  </button>
                </div>
              ) : null}

              {authMode === 'register' ? (
                <div className="flex items-start gap-3 rounded-xl bg-muted/50 p-3.5 text-xs leading-5 text-muted-foreground">
                  <Checkbox aria-label={intakeText.auth.acceptTermsAria} checked={hasAcceptedTerms} onCheckedChange={onTermsChange} className="mt-0.5" />
                  <span>{intakeText.auth.acceptTermsPrefix}{' '}
                    <button type="button" onClick={() => onOpenLegalDocument('terms')} className="cursor-pointer font-medium text-foreground underline underline-offset-4 hover:text-primary">{intakeText.auth.termsLabel}</button>{' '}
                    {intakeText.auth.acceptTermsConnector}{' '}
                    <button type="button" onClick={() => onOpenLegalDocument('privacy')} className="cursor-pointer font-medium text-foreground underline underline-offset-4 hover:text-primary">{intakeText.auth.privacyLabel}</button>
                    {intakeText.auth.acceptTermsSuffix}
                  </span>
                </div>
              ) : null}

              <Button type="submit" size="lg" disabled={isSigningIn} className="mt-2 h-11 w-full rounded-xl text-sm">
                {isSigningIn ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
                {isSigningIn ? intakeText.auth.signingIn
                  : authMode === 'login' ? intakeText.auth.signInAndContinue
                    : authMode === 'register' ? intakeText.auth.registerAndContinue
                      : authMode === 'resetPassword' ? intakeText.auth.sendReset
                        : translate('intake.auth.verifyEmail')}
                {!isSigningIn ? <ArrowRight className="ml-1 size-4" aria-hidden="true" /> : null}
              </Button>

              {authMode === 'resetPassword' || authMode === 'verifyEmail' ? (
                <div className="flex items-center justify-center gap-4">
                  <Button type="button" variant="ghost" size="sm" disabled={isSigningIn} onClick={() => changeMode('login')} className="gap-1.5 text-sm">
                    <ArrowLeft className="size-4" aria-hidden="true" />{intakeText.actions.backToLogin}
                  </Button>
                  {authMode === 'verifyEmail' ? <button type="button" disabled={isSigningIn} onClick={() => void onResendEmailCode()} className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                    {translate('intake.auth.resendCode')}
                  </button> : null}
                </div>
              ) : null}
            </motion.div>

          {authMode === 'login' ? (
            <div className="mt-6">
              <div className="mb-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" /><span>{intakeText.auth.oauthDivider}</span><span className="h-px flex-1 bg-border" /></div>
              {isInvitationRequired ? (
                <Input aria-label={translate('intake.auth.fields.oauthInvitationCodeAria')} type="text" value={invitationCode}
                  onChange={onInvitationCodeChange} autoComplete="off" disabled={isSigningIn}
                  placeholder={translate('intake.auth.fields.invitationCodePlaceholder')} leftIcon={<Ticket />}
                  className="mb-4" classNames={{ field: 'rounded-xl bg-background' }} />
              ) : null}
              <div className="grid grid-cols-5 gap-2.5">
                <OAuthButton provider="github" label="GitHub" onClick={onOAuthSignIn} disabled={isSigningIn} />
                <OAuthButton provider="google" label="Google" onClick={onOAuthSignIn} disabled={isSigningIn} />
                <OAuthButton provider="facebook" label="Facebook" onClick={onOAuthSignIn} disabled={isSigningIn} />
                <OAuthButton provider="x" label="X" onClick={onOAuthSignIn} disabled={isSigningIn} />
                <OAuthButton provider="discord" label="Discord" onClick={onOAuthSignIn} disabled={isSigningIn} />
              </div>
            </div>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OAuthButton({ provider, label, onClick, disabled }: {
  provider: SupabaseOAuthProvider;
  label: string;
  onClick: (provider: SupabaseOAuthProvider) => void | Promise<void>;
  disabled: boolean;
}) {
  return <Button type="button" variant="outline" size="icon-lg" aria-label={label} title={label} disabled={disabled}
    onClick={() => void onClick(provider)}
    className="h-11 w-full rounded-xl bg-background hover:border-foreground/30">
    <OAuthProviderIcon provider={provider} />
  </Button>;
}

function OAuthProviderIcon({ provider }: { provider: SupabaseOAuthProvider }) {
  if (provider === 'github') return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] fill-current">
    <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.05c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.74.08-.74 1.21.09 1.85 1.24 1.85 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.66-.3-5.46-1.33-5.46-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.29-1.23 3.29-1.23.66 1.66.25 2.88.12 3.18.77.84 1.24 1.91 1.24 3.22 0 4.61-2.8 5.63-5.48 5.93.43.37.82 1.1.82 2.22v3.29c0 .32.22.69.83.57A12 12 0 0 0 12 .5Z" />
  </svg>;
  if (provider === 'google') return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]">
    <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.53-.2-2.27H12v4.29h6.47a5.54 5.54 0 0 1-2.4 3.63v2.96h3.88c2.27-2.09 3.54-5.17 3.54-8.61Z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-2.96c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.05A12 12 0 0 0 12 24Z" />
    <path fill="#FBBC05" d="M5.27 14.33a7.2 7.2 0 0 1 0-4.66V6.62H1.26a12 12 0 0 0 0 10.76l4.01-3.05Z" />
    <path fill="#EA4335" d="M12 4.72c1.76 0 3.34.61 4.58 1.79l3.44-3.44A11.55 11.55 0 0 0 12 0 12 12 0 0 0 1.26 6.62l4.01 3.05C6.22 6.83 8.87 4.72 12 4.72Z" />
  </svg>;
  if (provider === 'facebook') return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px] fill-[#1877F2]">
    <path d="M24 12a12 12 0 1 0-13.875 11.854v-8.385H7.078V12h3.047V9.356c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.234 2.686.234v2.953h-1.513c-1.49 0-1.956.925-1.956 1.874V12h3.328l-.532 3.469h-2.796v8.385A12.002 12.002 0 0 0 24 12Z" />
  </svg>;
  if (provider === 'x') return <span aria-hidden="true" className="text-lg font-semibold leading-none">𝕏</span>;
  return <Gamepad2 className="size-[18px] text-[#5865F2]" aria-hidden="true" />;
}
