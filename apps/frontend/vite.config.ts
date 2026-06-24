import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],

    // Server configuration for development
    server: {
      port: Number.parseInt(env.VITE_PORT || env.PORT || '62173', 10),
      host: true, // Listen on all addresses
      proxy: {
        // Proxy API requests to backend during development
        '/api': {
          target: env.VITE_API_BASE_URL || 'http://localhost:62174',
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: env.VITE_WS_BASE_URL || 'ws://localhost:62174',
          ws: true,
          changeOrigin: true,
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

      // Enable code splitting and chunk optimization
      rollupOptions: {
        output: {
          // Manual chunk splitting for better caching and load performance
          manualChunks: {
            // Vendor chunks - separate large dependencies
            'react-vendor': ['react', 'react-dom'],
            'state-management': ['zustand'],
            'markdown': ['react-markdown'],
            'animation': ['framer-motion'],
            'ui-components': ['@headlessui/react'],
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
        'framer-motion',
        '@headlessui/react',
        'react-markdown',
      ],
    },

    // Define global constants
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    },
  }
})
