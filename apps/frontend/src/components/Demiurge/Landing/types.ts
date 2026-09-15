import type { BeeGameIntakeSettings } from '../../../services/beeGameAdapter';

export type Translate = (key: string, options?: Record<string, unknown>) => string;
export type AuthMode = 'login' | 'register' | 'resetPassword';

export type IntakeCopy = {
  modal: { chooseOption: string; productionSettings: string; confirmBuildBrief: string; startBuild: string; close: string };
  optionCard: { mode: string; gameplay: string };
  fields: { platform: string; engine: string; dimension: string; genre: string; style: string; inputs: string; notes: string; presentation: string; type: string; resourceLibrary: string; selectPlaceholder: string };
  resourceLibraryUsage: Record<BeeGameIntakeSettings['resourceLibraryUsage'], string>;
  actions: { chooseAgain: string; confirmBrief: string; edit: string; building: string; startBuild: string; continue: string; backToLogin: string; cancel: string; confirmGenerate: string; confirmBuild: string };
  starting: { title: string; description: string };
  errors: { missingPlatformModel: string; projectStartFailed: string; authNotConfigured: string; missingEmailPassword: string; missingDisplayName: string; termsRequired: string; missingProductionSettings: string };
  placeholders: { notes: string };
  profile: { displayNameFallback: string; emailFallback: string; balance: string; consumed: string; deleteAccount: string; deleteConfirm: string; deleteFailed: string; finish: string; saving: string };
  auth: { oauthDivider: string; signingIn: string; sendReset: string; registerAndContinue: string; signInAndContinue: string; oauthFailed: string; successTitle: string; errorTitle: string; loginSuccess: string; registerSuccess: string; resetEmailSent: string; feedbackClose: string; forgotPassword: string; acceptTermsAria: string; acceptTermsPrefix: string; termsLabel: string; privacyLabel: string; acceptTermsConnector: string; acceptTermsSuffix: string };
};

export type AuthFeedbackDialog = { kind: 'success' | 'error'; title: string; message: string };
export type LegalDocumentKind = 'terms' | 'privacy';
export type LegalDocumentBundle = Record<LegalDocumentKind, { title: string; updatedAt: string; intro: string; sections: Array<{ title: string; body: string }> }>;
