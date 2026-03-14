import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const useE2eMockAuth = typeof process !== 'undefined' && process.env.VITE_E2E_MOCK_AUTH === 'true';
const clerkMockPath = fileURLToPath(
  new URL('./tests/playwright/mocks/clerk.tsx', import.meta.url)
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: useE2eMockAuth
      ? {
          '@clerk/react': clerkMockPath,
        }
      : {},
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // NOSONAR: local dev proxy,
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
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
})
