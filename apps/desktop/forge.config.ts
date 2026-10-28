import type { ForgeConfig } from '@electron-forge/shared-types'
import MakerZIP from '@electron-forge/maker-zip'
import VitePlugin from '@electron-forge/plugin-vite'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEnv } from 'vite'

const frontend = path.resolve(__dirname, '../frontend')

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Bee Game Studio',
    executableName: 'BeeGameStudio',
    appBundleId: 'com.beegame.studio',
    icon: path.join(__dirname, 'assets/app-icon'),
    extraResource: [path.join(__dirname, 'frontend'), path.join(__dirname, 'assets/app-icon.png')],
    protocols: [{ name: 'BeeGame Studio', schemes: ['beegame'] }],
  },
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  hooks: {
    prePackage: async () => {
      await promisify(execFile)(process.execPath, [
        path.join(frontend, 'node_modules/vite/bin/vite.js'), 'build',
        '--outDir', path.join(__dirname, 'frontend'), '--emptyOutDir',
      ], {
        cwd: frontend,
        env: {
          ...loadEnv('production', path.resolve(frontend, '../..'), 'VITE_'),
          ...process.env,
          VITE_API_BASE_URL: process.env.VITE_API_BASE_URL || 'http://127.0.0.1:62174',
        },
        maxBuffer: 10 * 1024 * 1024,
      })
    },
  },
  plugins: [
    new VitePlugin({
      build: [
        { entry: 'src/main.ts', config: 'vite.main.config.ts' },
        { entry: 'src/preload.ts', config: 'vite.preload.config.ts' },
      ],
      renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
    }),
  ],
}

export default config
