import apiClient from './apiClient';

export type BeeGameCreditEstimate = {
  minCredits: number;
  maxCredits: number;
};

export type BeeGameCreditBalance = {
  userId: string;
  plan: 'free';
  balanceCredits: number;
  includedCredits: number;
  consumedCredits: number;
  reservedCredits: number;
  creditUnitWeightedTokens: number;
  estimates: {
    ideaIntake: BeeGameCreditEstimate;
    planningDocs: BeeGameCreditEstimate;
    smallPlayableGame: BeeGameCreditEstimate;
    standardGame: BeeGameCreditEstimate;
    complexGame: BeeGameCreditEstimate;
  };
};

export type BeeGameCreditTaskType =
  | 'idea_intake'
  | 'full_build'
  | 'edit_turn'
  | 'continue_turn'
  | 'asset_integration'
  | 'large_build'
  | 'agent_turn';

export type BeeGameCreditQuote = {
  taskType: BeeGameCreditTaskType;
  reservedCredits: number;
  displayName: string;
  description: string;
  balanceCredits: number;
  canStart: boolean;
  message: string;
};

export type BeeGameCreditLedgerEntry = {
  id: string;
  userId: string;
  kind: 'estimate' | 'reserve' | 'settle' | 'grant' | 'refund';
  credits: number;
  projectId?: string;
  reservationId?: string;
  weightedTokens?: number;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type BeeGameCreditSummary = {
  entriesCount: number;
  reservedCredits: number;
  settledCredits: number;
  refundedCredits: number;
  outstandingReservedCredits: number;
  weightedTokens: number;
};

export type BeeGameCreditAuditLedger = {
  entries: BeeGameCreditLedgerEntry[];
  summary: BeeGameCreditSummary;
};

export type BeeGameCreditAuditLedgerFilters = {
  userId?: string;
  projectId?: string;
  kind?: BeeGameCreditLedgerEntry['kind'];
  reservationId?: string;
};

export type BeeGameCreditGrant = {
  grantedCredits: number;
  balance: BeeGameCreditBalance;
};

export type BeeGameCreditGrantInput = {
  userId: string;
  credits: number;
  metadata?: Record<string, unknown>;
};

export type BeeGameStripeCreditPack = {
  priceId: string;
  credits: number;
};

export type BeeGameStripeCreditPacks = {
  packs: BeeGameStripeCreditPack[];
};

export type BeeGameStripeCheckoutSession = {
  id: string;
  url: string;
  priceId: string;
  credits: number;
};

export const getCreditBalance = (): Promise<BeeGameCreditBalance> => (
  apiClient.get('/api/credits')
);

export const getCreditQuote = (
  taskType: BeeGameCreditTaskType,
): Promise<BeeGameCreditQuote> => (
  apiClient.post('/api/credits/quote', { taskType })
);

export const getCreditLedger = (): Promise<BeeGameCreditLedgerEntry[]> => (
  apiClient.get('/api/credits/ledger')
);

export const getCreditSummary = (
  projectId?: string,
): Promise<BeeGameCreditSummary> => {
  const params = projectId ? { projectId } : undefined;
  return apiClient.get('/api/credits/summary', { params });
};

export const getCreditAuditLedger = (
  filters?: BeeGameCreditAuditLedgerFilters,
): Promise<BeeGameCreditAuditLedger> => (
  apiClient.get('/api/admin/credits/ledger', { params: filters })
);

export const grantCredits = (
  input: BeeGameCreditGrantInput,
): Promise<BeeGameCreditGrant> => (
  apiClient.post('/api/admin/credits/grants', input)
);

export const getStripeCreditPacks = (): Promise<BeeGameStripeCreditPacks> => (
  apiClient.get('/api/payments/stripe/credit-packs')
);

export const createStripeCheckoutSession = (
  priceId: string,
): Promise<BeeGameStripeCheckoutSession> => (
  apiClient.post('/api/payments/stripe/checkout-session', { priceId })
);
