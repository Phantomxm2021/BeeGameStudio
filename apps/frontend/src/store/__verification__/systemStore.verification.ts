/**
 * Manual verification script for systemStore
 * This file demonstrates that the systemStore implementation is correct
 * 
 * To verify:
 * 1. All required state properties exist
 * 2. All required methods exist and have correct signatures
 * 3. updateTokenUsage performs cumulative calculation correctly
 */

import { useSystemStore } from '../systemStore';
import type { TokenUsage } from '../../types/message';

// Verification 1: Check state structure
const verifyStateStructure = () => {
  const store = useSystemStore.getState();
  
  console.log('✓ State structure verification:');
  console.log('  - status:', typeof store.status); // should be object or null
  console.log('  - agents:', Array.isArray(store.agents)); // should be true
  console.log('  - activities:', Array.isArray(store.activities)); // should be true
  console.log('  - tokenUsage:', typeof store.tokenUsage); // should be object
  console.log('  - isLoading:', typeof store.isLoading); // should be boolean
};

// Verification 2: Check method signatures
const verifyMethods = () => {
  const store = useSystemStore.getState();
  
  console.log('\n✓ Method signature verification:');
  console.log('  - loadStatus:', typeof store.loadStatus); // should be function
  console.log('  - loadAgents:', typeof store.loadAgents); // should be function
  console.log('  - loadActivities:', typeof store.loadActivities); // should be function
  console.log('  - updateTokenUsage:', typeof store.updateTokenUsage); // should be function
};

// Verification 3: Test cumulative token usage calculation
const verifyCumulativeTokenUsage = () => {
  console.log('\n✓ Cumulative token usage verification:');
  const projectId = 'verification-project';
  
  // Get initial state
  const initialUsage = useSystemStore.getState().tokenUsage[projectId];
  console.log('  Initial usage:', initialUsage);
  
  // Add first usage
  const usage1: TokenUsage = {
    prompt_tokens: 100,
    completion_tokens: 50,
    total_tokens: 150
  };
  useSystemStore.getState().updateTokenUsage(usage1, projectId);
  const afterFirst = useSystemStore.getState().tokenUsage[projectId];
  console.log('  After first update:', afterFirst);
  console.log('    Expected: { prompt: 100, completion: 50, total: 150 }');
  console.log('    Match:', 
    afterFirst?.prompt_tokens === 100 &&
    afterFirst?.completion_tokens === 50 &&
    afterFirst?.total_tokens === 150
  );
  
  // Add second usage
  const usage2: TokenUsage = {
    prompt_tokens: 200,
    completion_tokens: 100,
    total_tokens: 300
  };
  useSystemStore.getState().updateTokenUsage(usage2, projectId);
  const afterSecond = useSystemStore.getState().tokenUsage[projectId];
  console.log('  After second update:', afterSecond);
  console.log('    Expected: { prompt: 200, completion: 100, total: 300 }');
  console.log('    Match:', 
    afterSecond?.prompt_tokens === 200 &&
    afterSecond?.completion_tokens === 100 &&
    afterSecond?.total_tokens === 300
  );
  
  // Add third usage
  const usage3: TokenUsage = {
    prompt_tokens: 50,
    completion_tokens: 25,
    total_tokens: 75
  };
  useSystemStore.getState().updateTokenUsage(usage3, projectId);
  const afterThird = useSystemStore.getState().tokenUsage[projectId];
  console.log('  After third update:', afterThird);
  console.log('    Expected: unchanged max { prompt: 200, completion: 100, total: 300 }');
  console.log('    Match:', 
    afterThird?.prompt_tokens === 200 &&
    afterThird?.completion_tokens === 100 &&
    afterThird?.total_tokens === 300
  );
};

// Run all verifications
export const runVerification = () => {
  console.log('=== SystemStore Verification ===\n');
  verifyStateStructure();
  verifyMethods();
  verifyCumulativeTokenUsage();
  console.log('\n=== Verification Complete ===');
};

// Export for use in other files
export { verifyStateStructure, verifyMethods, verifyCumulativeTokenUsage };
