import { describe, expect, it } from 'vitest';

import {
  getClerkUnavailableMessage,
  isClerkLoadFailureReason,
  isClerkScriptTarget,
} from '../../src/auth/clerkLoadFailure';

describe('clerkLoadFailure utils', () => {
  it('recognizes Clerk load failures from multiple reason shapes', () => {
    expect(isClerkLoadFailureReason('failed_to_load_clerk_js')).toBe(true);
    expect(isClerkLoadFailureReason(new Error('Failed to load Clerk JS'))).toBe(
      true,
    );
    expect(
      isClerkLoadFailureReason({
        message: 'Failed to load script: https://cdn.clerk.com/app.js',
      }),
    ).toBe(true);
    expect(
      isClerkLoadFailureReason({
        code: 'clerk.browser.js failed to boot',
      }),
    ).toBe(true);
    expect(
      isClerkLoadFailureReason({
        toString: () => 'Failed to load Clerk JS from extension',
      }),
    ).toBe(true);
    expect(isClerkLoadFailureReason({ message: 'some other issue' })).toBe(
      false,
    );
    expect(isClerkLoadFailureReason(null)).toBe(false);
  });

  it('detects only Clerk-owned script targets', () => {
    const clerkScript = document.createElement('script');
    clerkScript.src = 'https://cdn.clerk.accounts.dev/browser.js';

    const anotherScript = document.createElement('script');
    anotherScript.src = 'https://example.com/app.js';

    const nonScript = document.createElement('div');

    expect(isClerkScriptTarget(clerkScript)).toBe(true);
    expect(isClerkScriptTarget(anotherScript)).toBe(false);
    expect(isClerkScriptTarget(nonScript)).toBe(false);
    expect(isClerkScriptTarget(null)).toBe(false);
  });

  it('returns the anonymous-mode guidance copy', () => {
    expect(getClerkUnavailableMessage()).toContain('autenticacao');
    expect(getClerkUnavailableMessage()).toContain('login fica desativado');
  });
});
