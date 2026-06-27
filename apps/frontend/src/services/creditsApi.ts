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

export const getCreditBalance = (): Promise<BeeGameCreditBalance> => (
  apiClient.get('/api/credits')
);
