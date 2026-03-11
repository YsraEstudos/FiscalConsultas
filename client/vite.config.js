import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
