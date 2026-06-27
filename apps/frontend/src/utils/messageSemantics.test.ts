import { describe, expect, it } from 'vitest';

import { normalizeCanonicalMessageType } from './messageSemantics';

describe('message semantics', () => {
  it('normalizes artifact render hints into artifact cards', () => {
    expect(normalizeCanonicalMessageType({
      renderHint: 'artifact_card',
      content: 'plain text without GDD keyword',
    })).toBe('artifact_card');
  });

  it('maps explicit revision requests into revision_request', () => {
    expect(normalizeCanonicalMessageType({
      requiresUserAction: true,
      nextAction: 'revise',
      content: '需要修订',
    })).toBe('revision_request');
  });

  it('maps generic user-action requests into approval_request', () => {
    expect(normalizeCanonicalMessageType({
      requiresUserAction: true,
      content: '需要确认',
    })).toBe('approval_request');
  });

  it('does not infer artifact cards from document-like content without explicit protocol fields', () => {
    expect(normalizeCanonicalMessageType({
      content: '# GDD\n\n## Core Loop\n\nLong content that looks like a document.'.repeat(40),
    })).toBe('text');
  });
});
