import { describe, expect, it } from 'vitest';

import { validateProductionEnv } from './validate-production-env.mjs';

const validProductionEnv = {
  GITHUB_ACTIONS: 'true',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
  VITE_FISCAL_R2_BASE_URL: 'https://example.r2.dev/fiscal',
  VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
};

describe('validateProductionEnv', () => {
  it('requires the static fiscal R2 configuration for production builds', () => {
    expect(() =>
      validateProductionEnv({
        GITHUB_ACTIONS: 'true',
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
      }),
    ).toThrow(/VITE_FISCAL_R2_BASE_URL[\s\S]*VITE_OFFLINE_DB_PUBLIC_SEED/);
  });

  it('rejects non-HTTPS fiscal R2 URLs in production builds', () => {
    expect(() =>
      validateProductionEnv({
        ...validProductionEnv,
        VITE_FISCAL_R2_BASE_URL: 'http://example.test/fiscal',
      }),
    ).toThrow(/VITE_FISCAL_R2_BASE_URL must use an HTTPS URL/);
  });

  it('accepts complete static fiscal R2 production configuration', () => {
    expect(() => validateProductionEnv(validProductionEnv)).not.toThrow();
  });
});
