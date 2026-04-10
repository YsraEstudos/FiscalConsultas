import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

function isTruthyFlag(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function resolveBuildEnv(mode = 'production', shellEnv = process.env) {
  return {
    ...loadEnv(mode, process.cwd(), ''),
    ...shellEnv,
  };
}

export function validateProductionEnv(env = resolveBuildEnv()) {
  const errors = [];
  const publishableKey = String(env.VITE_CLERK_PUBLISHABLE_KEY || '').trim();
  const adminEmail = String(env.VITE_ADMIN_EMAIL || '').trim();

  if (isTruthyFlag(env.VITE_AUTH_DEBUG)) {
    errors.push('VITE_AUTH_DEBUG must be false for production builds.');
  }

  if (adminEmail) {
    errors.push('VITE_ADMIN_EMAIL must not be defined for production builds.');
  }

  if (publishableKey.startsWith('pk_test_')) {
    errors.push('VITE_CLERK_PUBLISHABLE_KEY must use a live Clerk key for production builds.');
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
