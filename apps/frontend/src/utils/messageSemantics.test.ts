import { describe, expect, it } from 'vitest';

import { normalizeCanonicalMessageType } from './messageSemantics';

describe('message semantics', () => {
  it('normalizes artifact render hints into artifact cards', () => {
    expect(normalizeCanonicalMessageType({
      renderHint: 'artifact_card',
      content: 'plain text without GDD keyword',
    })).toBe('artifact_card');
  });

  it('does not revive removed revision-request semantics from generic fields', () => {
    expect(normalizeCanonicalMessageType({
      requiresUserAction: true,
      nextAction: 'revise',
      content: '需要修订',
    })).toBe('system_status');
  });

  it('does not revive removed approval semantics from generic fields', () => {
    expect(normalizeCanonicalMessageType({
      requiresUserAction: true,
      content: '需要确认',
    })).toBe('system_status');
  });

  it('does not infer artifact cards from document-like content without explicit protocol fields', () => {
    expect(normalizeCanonicalMessageType({
      content: '# GDD\n\n## Core Loop\n\nLong content that looks like a document.'.repeat(40),
    })).toBe('text');
  });
});
