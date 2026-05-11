import { describe, expect, it } from 'vitest';

import { validateProductionEnv } from '../../scripts/validate-production-env.mjs';

describe('validateProductionEnv', () => {
  it('accepts production-safe frontend settings', () => {
    expect(() => validateProductionEnv({
      VITE_AUTH_DEBUG: 'false',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_valid',
    })).not.toThrow();
  });

  it('accepts test Clerk keys for Cloudflare Pages preview builds', () => {
    expect(() => validateProductionEnv({
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'feature/security-preview',
      CF_PAGES_PRODUCTION_BRANCH: 'main',
      VITE_AUTH_DEBUG: 'false',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_preview',
    })).not.toThrow();
  });

  it('allows Cloudflare Pages preview builds without production-only variables', () => {
    expect(() => validateProductionEnv({
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'codex/offline-first-ops-tests',
      CF_PAGES_PRODUCTION_BRANCH: 'main',
    })).not.toThrow();
  });

  it('blocks production builds with auth debug, hardcoded admin email, or test Clerk keys', () => {
    expect(() => validateProductionEnv({
      GITHUB_ACTIONS: 'true',
      VITE_AUTH_DEBUG: 'true',
      VITE_ADMIN_EMAIL: 'admin@example.com',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_invalid',
    })).toThrow(/Production build blocked/);
  });

  it('blocks missing or secret Clerk keys in production builds', () => {
    expect(() => validateProductionEnv({
      GITHUB_ACTIONS: 'true',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: '',
    })).toThrow(/must be defined/i);

    expect(() => validateProductionEnv({
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'sk_live_secret',
    })).toThrow(/never a secret key/i);
  });

  it('blocks missing R2 bundle configuration in production builds', () => {
    expect(() => validateProductionEnv({
      GITHUB_ACTIONS: 'true',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_valid',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
    })).toThrow(/VITE_FISCAL_R2_BASE_URL/);

    expect(() => validateProductionEnv({
      GITHUB_ACTIONS: 'true',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_valid',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
    })).toThrow(/VITE_OFFLINE_DB_PUBLIC_SEED/);
  });

  it('still requires live Clerk keys on the Cloudflare Pages production branch', () => {
    expect(() => validateProductionEnv({
      CF_PAGES: '1',
      CF_PAGES_BRANCH: 'main',
      CF_PAGES_PRODUCTION_BRANCH: 'main',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_preview',
    })).toThrow(/live Clerk publishable key/i);
  });

  it('allows pk_test temporarily when ALLOW_TEST_CLERK_KEY is explicitly enabled in CI', () => {
    expect(() => validateProductionEnv({
      GITHUB_ACTIONS: 'true',
      ALLOW_TEST_CLERK_KEY: 'true',
      VITE_AUTH_DEBUG: 'false',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_temp_override',
    })).not.toThrow();
  });

  it('allows local test keys when running outside CI', () => {
    expect(() => validateProductionEnv({
      ALLOW_TEST_CLERK_KEY: 'true',
      VITE_FISCAL_R2_BASE_URL: 'https://fiscal-bases.example.com',
      VITE_OFFLINE_DB_PUBLIC_SEED: 'public-seed',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_local_attempt',
    })).not.toThrow();
  });
});
