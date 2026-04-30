import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

function isTruthyFlag(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function isCiTestKeyOverrideEnabled(env) {
  return isTruthyFlag(env.ALLOW_TEST_CLERK_KEY) && isTruthyFlag(env.GITHUB_ACTIONS);
}

function resolveBuildEnv(mode = 'production', shellEnv = process.env) {
  return {
    ...loadEnv(mode, process.cwd(), ''),
    ...shellEnv,
  };
}

function isCloudflarePagesBuild(env) {
  return String(env.CF_PAGES || '').trim() === '1';
}

function isCiBuild(env) {
  return isTruthyFlag(env.CI) || isTruthyFlag(env.GITHUB_ACTIONS);
}

function resolveProductionBranch(env) {
  return String(
    env.CF_PAGES_PRODUCTION_BRANCH
    || env.PAGES_PRODUCTION_BRANCH
    || env.PRODUCTION_BRANCH
    || 'main',
  ).trim();
}

function isRealProductionBuild(env) {
  if (!isCiBuild(env) && !isCloudflarePagesBuild(env)) {
    return false;
  }

  if (!isCloudflarePagesBuild(env)) {
    return true;
  }

  const currentBranch = String(env.CF_PAGES_BRANCH || '').trim();
  const productionBranch = resolveProductionBranch(env);
  return !!currentBranch && currentBranch === productionBranch;
}

export function validateProductionEnv(env = resolveBuildEnv()) {
  const errors = [];
  const publishableKey = String(env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
  const adminEmail = String(env.VITE_ADMIN_EMAIL || '').trim();
  const requireLivePublishableKey = isRealProductionBuild(env);
  const allowTestPublishableKey = isCiTestKeyOverrideEnabled(env);
  const isLivePublishableKey = publishableKey.startsWith('pk_live_');
  const isTestPublishableKey = publishableKey.startsWith('pk_test_');

  if (isTruthyFlag(env.VITE_AUTH_DEBUG)) {
    errors.push('VITE_AUTH_DEBUG must be false for production builds.');
  }

  if (adminEmail) {
    errors.push('VITE_ADMIN_EMAIL must not be defined for production builds.');
  }

  if (!publishableKey) {
    errors.push('VITE_CLERK_PUBLISHABLE_KEY must be defined for production builds.');
  } else if (publishableKey.startsWith('sk_')) {
    errors.push('VITE_CLERK_PUBLISHABLE_KEY must use a Clerk publishable key, never a secret key.');
  } else if (!isLivePublishableKey && !isTestPublishableKey) {
    errors.push('VITE_CLERK_PUBLISHABLE_KEY must start with pk_live_ or pk_test_.');
  } else if (
    requireLivePublishableKey
    && !isLivePublishableKey
    && !(allowTestPublishableKey && isTestPublishableKey)
  ) {
    errors.push('VITE_CLERK_PUBLISHABLE_KEY must use a live Clerk publishable key for production builds.');
  }

  if (errors.length > 0) {
    throw new Error(`Production build blocked:\n- ${errors.join('\n- ')}`);
  }
}

const isCliExecution =
  typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliExecution) {
  try {
    validateProductionEnv(resolveBuildEnv());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}
