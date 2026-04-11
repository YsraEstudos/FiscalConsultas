import { describe, expect, it } from 'vitest';

import { validateProductionEnv } from '../../scripts/validate-production-env.mjs';

describe('validateProductionEnv', () => {
  it('accepts production-safe frontend settings', () => {
    expect(() => validateProductionEnv({
      VITE_AUTH_DEBUG: 'false',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_valid',
    })).not.toThrow();
  });

  it('blocks production builds with auth debug, hardcoded admin email, or test Clerk keys', () => {
    expect(() => validateProductionEnv({
      VITE_AUTH_DEBUG: 'true',
      VITE_ADMIN_EMAIL: 'admin@example.com',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_invalid',
    })).toThrow(/Production build blocked/);
  });

  it('blocks missing or secret Clerk keys in production builds', () => {
    expect(() => validateProductionEnv({
      VITE_CLERK_PUBLISHABLE_KEY: '',
    })).toThrow(/must be defined/i);

    expect(() => validateProductionEnv({
      VITE_CLERK_PUBLISHABLE_KEY: 'sk_live_secret',
    })).toThrow(/never a secret key/i);
  });
});
