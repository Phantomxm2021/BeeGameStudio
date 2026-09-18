import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { BEEGAME_FIXED_SERVICE_PORTS } from '../../packages/agent-workflow-server/src/beegame/fixed-service-ports'

const frontendReactPath = fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url))
const frontendReactJsxRuntimePath = fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url))
const frontendReactJsxDevRuntimePath = fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url))
const frontendReactDomPath = fileURLToPath(new URL('./node_modules/react-dom/index.js', import.meta.url))
const frontendReactDomClientPath = fileURLToPath(new URL('./node_modules/react-dom/client.js', import.meta.url))
const frontendSrcPath = fileURLToPath(new URL('./src', import.meta.url))
const frontendThreePath = fileURLToPath(new URL('./node_modules/three', import.meta.url))
const frontendFiberPath = fileURLToPath(new URL('./node_modules/@react-three/fiber', import.meta.url))
const frontendDreiPath = fileURLToPath(new URL('./node_modules/@react-three/drei', import.meta.url))
const frontendLucidePath = fileURLToPath(new URL('./node_modules/lucide-react', import.meta.url))
const frontendRadixDialogPath = fileURLToPath(new URL('./node_modules/@radix-ui/react-dialog', import.meta.url))
const frontendRadixDropdownPath = fileURLToPath(new URL('./node_modules/@radix-ui/react-dropdown-menu', import.meta.url))
const frontendRadixTogglePath = fileURLToPath(new URL('./node_modules/@radix-ui/react-toggle', import.meta.url))
const frontendRadixContextMenuPath = fileURLToPath(new URL('./node_modules/@radix-ui/react-context-menu', import.meta.url))
const sceneEditorSrcPath = fileURLToPath(new URL('../../packages/scene-editor/src/index.ts', import.meta.url))
const sceneEditorPlatformPath = fileURLToPath(new URL('../../packages/scene-editor/src/platform.ts', import.meta.url))
const sceneEditorStylesPath = fileURLToPath(new URL('../../packages/scene-editor/src/styles.css', import.meta.url))
const browserNodeBuiltinShimPath = fileURLToPath(new URL('./src/shims/nodeBuiltin.ts', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')
  for (const name of ['VITE_PORT', 'PORT']) {
    if (env[name] && env[name] !== String(BEEGAME_FIXED_SERVICE_PORTS.frontend))
      throw new Error(`${name} must use fixed frontend port ${BEEGAME_FIXED_SERVICE_PORTS.frontend}`)
  }

  return {
    plugins: [react()],

    resolve: {
      alias: [
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
        { find: 'fs', replacement: browserNodeBuiltinShimPath },
        { find: 'path', replacement: browserNodeBuiltinShimPath },
        { find: 'crypto', replacement: browserNodeBuiltinShimPath },
        { find: '@', replacement: frontendSrcPath },
      ],
      dedupe: ['react', 'react-dom'],
    },

    // Server configuration for development
    server: {
      port: BEEGAME_FIXED_SERVICE_PORTS.frontend,
      strictPort: true,
      host: true, // Listen on all addresses
      proxy: {
        // Proxy API requests to backend during development
        '/api': {
          target: env.VITE_API_BASE_URL || `http://127.0.0.1:${BEEGAME_FIXED_SERVICE_PORTS.runtime}`,
          changeOrigin: true,
          secure: false,
        },
        '/deployments': {
          target: env.VITE_API_BASE_URL || `http://127.0.0.1:${BEEGAME_FIXED_SERVICE_PORTS.runtime}`,
          changeOrigin: true,
          secure: false,
        },
        '/previews': {
          target: env.VITE_API_BASE_URL || `http://127.0.0.1:${BEEGAME_FIXED_SERVICE_PORTS.runtime}`,
          changeOrigin: true,
          secure: false,
        },
      },
    },

    // Preview server configuration
    preview: {
      port: 4173,
      host: true,
    },

    // Build configuration for production
    build: {
      // Output directory
      outDir: 'dist',

      // Generate sourcemaps for production (optional, set to false for smaller builds)
      sourcemap: mode === 'development',

      // Minify with esbuild (faster) or terser (smaller)
      minify: 'esbuild',

      // Target browsers
      target: 'es2015',

      // Keep unprefixed backdrop-filter for browsers that do not use the WebKit prefix.
      cssTarget: ['chrome111', 'firefox115', 'safari16'],

      // Enable code splitting and chunk optimization
      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching and load performance
          manualChunks: {
            // Vendor chunks - separate large dependencies
            'react-vendor': ['react', 'react-dom'],
            'state-management': ['zustand'],
            'markdown': ['react-markdown'],
            'animation': ['motion'],
            // Feature chunks - group related components
          },

          // Asset file naming
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name?.split('.')
            let extType = info?.[info.length - 1]

            if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(extType || '')) {
              extType = 'images'
            } else if (/woff|woff2|eot|ttf|otf/i.test(extType || '')) {
              extType = 'fonts'
            }

            return `assets/${extType}/[name]-[hash][extname]`
          },

          // Chunk file naming
          chunkFileNames: 'assets/js/[name]-[hash].js',

          // Entry file naming
          entryFileNames: 'assets/js/[name]-[hash].js',
        },
      },

      // Increase chunk size warning limit for better optimization
      chunkSizeWarningLimit: 1000,

      // Optimize dependencies
      commonjsOptions: {
        include: [/node_modules/],
      },
    },

    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'zustand',
        'axios',
        'react-markdown',
        'motion',
      ],
    },

    // Define global constants
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },

  }
})
