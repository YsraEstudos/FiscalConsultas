import { describe, expect, it } from 'vitest';

import {
    getClerkUnavailableMessage,
    isClerkLoadFailureReason,
    isClerkScriptTarget,
} from './clerkLoadFailure';

describe('clerkLoadFailure', () => {
    it('detects Clerk runtime load failures from error objects', () => {
        const error = new Error('Clerk: Failed to load Clerk JS');

        expect(isClerkLoadFailureReason(error)).toBe(true);
        expect(isClerkLoadFailureReason({ code: 'failed_to_load_clerk_js' })).toBe(true);
        expect(isClerkLoadFailureReason('failed to load script: https://example.clerk.accounts.dev/clerk.browser.js')).toBe(true);
    });

    it('ignores unrelated errors', () => {
        expect(isClerkLoadFailureReason(new Error('Network Error'))).toBe(false);
        expect(isClerkLoadFailureReason('Unexpected token < in JSON')).toBe(false);
    });

    it('matches only Clerk script targets', () => {
        const clerkScript = document.createElement('script');
        clerkScript.src = 'https://delicate-hedgehog-15.clerk.accounts.dev/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

        const unrelatedScript = document.createElement('script');
        unrelatedScript.src = 'https://example.com/assets/index.js';

        expect(isClerkScriptTarget(clerkScript)).toBe(true);
        expect(isClerkScriptTarget(unrelatedScript)).toBe(false);
        expect(isClerkScriptTarget(null)).toBe(false);
    });

    it('returns a user-facing fallback message', () => {
        expect(getClerkUnavailableMessage()).toContain('autenticacao');
    });
});
