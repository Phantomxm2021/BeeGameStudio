import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const frontendReactPath = path.resolve(__dirname, './node_modules/react/index.js');
const frontendReactJsxRuntimePath = path.resolve(__dirname, './node_modules/react/jsx-runtime.js');
const frontendReactJsxDevRuntimePath = path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js');
const frontendReactDomPath = path.resolve(__dirname, './node_modules/react-dom/index.js');
const frontendReactDomClientPath = path.resolve(__dirname, './node_modules/react-dom/client.js');
const frontendThreePath = path.resolve(__dirname, './node_modules/three');
const frontendFiberPath = path.resolve(__dirname, './node_modules/@react-three/fiber');
const frontendDreiPath = path.resolve(__dirname, './node_modules/@react-three/drei');
const frontendLucidePath = path.resolve(__dirname, './node_modules/lucide-react');
const frontendRadixDialogPath = path.resolve(__dirname, './node_modules/@radix-ui/react-dialog');
const frontendRadixDropdownPath = path.resolve(__dirname, './node_modules/@radix-ui/react-dropdown-menu');
const frontendRadixTogglePath = path.resolve(__dirname, './node_modules/@radix-ui/react-toggle');
const frontendRadixContextMenuPath = path.resolve(__dirname, './node_modules/@radix-ui/react-context-menu');
const sceneEditorSrcPath = path.resolve(__dirname, '../../packages/scene-editor/src/index.ts');
const sceneEditorPlatformPath = path.resolve(__dirname, '../../packages/scene-editor/src/platform.ts');
const sceneEditorStylesPath = path.resolve(__dirname, '../../packages/scene-editor/src/styles.css');

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    // Node 25 exposes experimental process-level Web Storage. Tests use
    // jsdom's isolated implementation, so disable the process-level copy in
    // workers instead of letting Node probe an unset --localstorage-file.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: './src/test/setup.ts',
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
      { find: '@beegame/scene-editor/styles.css', replacement: sceneEditorStylesPath },
      { find: '@beegame/scene-editor/platform', replacement: sceneEditorPlatformPath },
      { find: '@beegame/scene-editor', replacement: sceneEditorSrcPath },
      { find: '@react-three/fiber', replacement: frontendFiberPath },
      { find: '@react-three/drei', replacement: frontendDreiPath },
      { find: '@radix-ui/react-dialog', replacement: frontendRadixDialogPath },
      { find: '@radix-ui/react-dropdown-menu', replacement: frontendRadixDropdownPath },
      { find: '@radix-ui/react-toggle', replacement: frontendRadixTogglePath },
      { find: '@radix-ui/react-context-menu', replacement: frontendRadixContextMenuPath },
      { find: 'lucide-react', replacement: frontendLucidePath },
      { find: 'three', replacement: frontendThreePath },
      { find: 'react/jsx-dev-runtime', replacement: frontendReactJsxDevRuntimePath },
      { find: 'react/jsx-runtime', replacement: frontendReactJsxRuntimePath },
      { find: 'react-dom/client', replacement: frontendReactDomClientPath },
      { find: 'react-dom', replacement: frontendReactDomPath },
      { find: 'react', replacement: frontendReactPath },
    ],
    dedupe: ['react', 'react-dom'],
  },
});
