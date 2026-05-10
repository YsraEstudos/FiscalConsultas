import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const clerkMockPath = fileURLToPath(
  new URL('./tests/playwright/mocks/clerk.tsx', import.meta.url)
);

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const useE2eMockAuth = env.VITE_E2E_MOCK_AUTH === 'true';
  const rawPublicBasePath = env.VITE_PUBLIC_BASE_PATH || '/';
  const normalizedPublicBasePath = rawPublicBasePath.endsWith('/') ? rawPublicBasePath : `${rawPublicBasePath}/`;
  const defaultApiBaseUrl = 'http://127.0.0.1:8000';
  const rawApiBaseUrl = env.VITE_API_FILTER_URL || env.VITE_API_URL || 'http://127.0.0.1:8000';
  const normalizedApiBaseUrl = rawApiBaseUrl.replace(/\/$/, '');
  const candidateProxyTarget = normalizedApiBaseUrl.endsWith('/api')
    ? normalizedApiBaseUrl.slice(0, -4)
    : normalizedApiBaseUrl;
  const proxyTarget = /^(https?:)?\/\//.test(candidateProxyTarget)
    ? candidateProxyTarget
    : defaultApiBaseUrl;

  return {
    base: normalizedPublicBasePath,
    plugins: [react()],
    resolve: {
      alias: useE2eMockAuth
        ? {
            '@clerk/react': clerkMockPath,
          }
        : {},
    },
    server: {
      headers: crossOriginIsolationHeaders,
      proxy: {
        '/api': {
          target: proxyTarget, // NOSONAR: dev proxy target comes from local env or local backend
          changeOrigin: true
        }
      }
    },
    preview: {
      allowedHosts: ['offline-e2e.local'],
      headers: crossOriginIsolationHeaders,
    },
    optimizeDeps: {
      exclude: ['@sqlite.org/sqlite-wasm'],
    },
    worker: {
      format: 'es',
    },
    build: {
      // --- Security hardening: never expose source maps in production ---
      sourcemap: false,
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: mode === 'production',
          drop_debugger: true,
          passes: 2,
        },
        mangle: {
          toplevel: true,
        },
        format: {
          comments: false,
        },
      },
      rollupOptions: {
        output: {
          // Hashed filenames make it harder to correlate builds
          entryFileNames: 'assets/[hash:16].js',
          chunkFileNames: 'assets/[hash:16].js',
          assetFileNames: 'assets/[hash:16].[ext]',
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/setupTests.ts',
      testTimeout: 15000,
      css: true,
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
        'tests/playwright/**'
      ],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json-summary', 'html'],
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          '**/*.css',
          '**/*.module.css',
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/setupTests.ts',
          'src/vite-env.d.ts',
        ],
        reportOnFailure: true,
        thresholds: {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 70,
        },
      },
    },
  };
})
