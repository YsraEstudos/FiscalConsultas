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
});
