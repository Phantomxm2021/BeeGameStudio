import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const frontendReactPath = path.resolve(__dirname, './node_modules/react/index.js');
const frontendReactJsxRuntimePath = path.resolve(__dirname, './node_modules/react/jsx-runtime.js');
const frontendReactJsxDevRuntimePath = path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js');
const frontendReactDomPath = path.resolve(__dirname, './node_modules/react-dom/index.js');
const frontendReactDomClientPath = path.resolve(__dirname, './node_modules/react-dom/client.js');

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    server: {
      deps: {
        inline: ['@shadcn/react'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/mockData',
        'dist/',
      ],
    },
  },
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(__dirname, './src') },
      { find: 'react/jsx-dev-runtime', replacement: frontendReactJsxDevRuntimePath },
      { find: 'react/jsx-runtime', replacement: frontendReactJsxRuntimePath },
      { find: 'react-dom/client', replacement: frontendReactDomClientPath },
      { find: 'react-dom', replacement: frontendReactDomPath },
      { find: 'react', replacement: frontendReactPath },
    ],
    dedupe: ['react', 'react-dom'],
  },
  ssr: {
    noExternal: ['@shadcn/react'],
  },
});
