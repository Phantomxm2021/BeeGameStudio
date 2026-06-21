import { describe, expect, test } from 'bun:test';
import { VoiceContext, VoiceProvider } from '../voice';

describe('voice context', () => {
  test('exports VoiceContext for the AppState noop provider path', () => {
    expect(VoiceContext).toBeDefined();
    expect(VoiceContext.Provider).toBeDefined();
    expect(VoiceProvider).toBeDefined();
  });
});
