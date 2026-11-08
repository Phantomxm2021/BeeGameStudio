import type { ForgeConfig } from '@electron-forge/shared-types'
import MakerZIP from '@electron-forge/maker-zip'
import VitePlugin from '@electron-forge/plugin-vite'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { loadEnv } from 'vite'
import { prepareLocalRuntime } from './runtime-package'

const frontend = path.resolve(__dirname, '../frontend')
const repo = path.resolve(__dirname, '../..')
const local = !(process.env.BEEGAME_DESKTOP_APP_URL?.trim() || process.env.VITE_BEEGAME_DESKTOP_APP_URL?.trim())

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'Bee Game Studio',
    executableName: 'BeeGameStudio',
    appBundleId: 'com.beegame.studio',
    icon: path.join(__dirname, 'assets/app-icon'),
    extraResource: [path.join(__dirname, 'frontend'), path.join(__dirname, 'assets/app-icon.png'),
      ...(local ? [path.join(__dirname, 'runtime')] : [])],
    protocols: [{ name: 'BeeGame Studio', schemes: ['beegame'] }],
  },
  makers: [new MakerZIP({}, ['darwin', 'linux', 'win32'])],
  hooks: {
    prePackage: async (_config, platform, arch) => {
      const publicEnv = { ...loadEnv('production', repo, 'VITE_'), ...process.env }
      if (local) await prepareLocalRuntime(repo, __dirname, platform, arch, publicEnv)
      await promisify(execFile)(process.execPath, [
        path.join(frontend, 'node_modules/vite/bin/vite.js'), 'build',
        '--outDir', path.join(__dirname, 'frontend'), '--emptyOutDir',
      ], {
        cwd: frontend,
        env: {
          ...publicEnv,
          VITE_API_BASE_URL: local ? 'http://127.0.0.1:62174' : (process.env.VITE_API_BASE_URL || 'http://127.0.0.1:62174'),
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
