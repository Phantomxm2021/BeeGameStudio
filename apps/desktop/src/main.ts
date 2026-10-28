import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  ipcMain,
  session,
  shell,
  screen,
  nativeTheme,
  net,
  protocol,
} from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DEV_RENDERER_URL, getRendererUrl, getTrustedOrigins } from './config'
import { serveBundledRenderer } from './bundledRenderer'
import {
  captureWindowBounds,
  clampWindowBounds,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  parseOAuthCallbackUrl,
  sanitizeFileName,
} from './security'

let mainWindow: BrowserWindow | null = null
let creatingWindow = false
let rendererUrl = ''
let trustedOrigins = new Set<string>()
let pendingOAuthCallback: string | null = null
let oauthListenerReady = false
let desktopCommandsReady = false
let pendingDesktopCommand: 'new-project' | 'toggle-sidebar' | 'focus-input' | null = null
let boundsTimer: NodeJS.Timeout | undefined
let rendererFailurePageLoading = false

const DEFAULT_WINDOW_BOUNDS = { x: 0, y: 0, width: 1440, height: 900 }
const MIN_WINDOW_WIDTH = 720
const MIN_WINDOW_HEIGHT = 480

function appIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app-icon.png')
    : path.join(app.getAppPath(), 'assets/app-icon.png')
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

async function readWindowBounds(): Promise<Electron.Rectangle | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(stateFilePath(), 'utf8'),
    ) as Partial<Electron.Rectangle>
    if (
      ![parsed.x, parsed.y, parsed.width, parsed.height].every(
        value => typeof value === 'number' && Number.isFinite(value),
      )
    )
      return null
    const candidate = parsed as Electron.Rectangle
    if (
      candidate.width < MIN_WINDOW_WIDTH ||
      candidate.height < MIN_WINDOW_HEIGHT
    )
      return null
    return clampWindowBounds(
      candidate,
      screen.getAllDisplays().map(display => display.workArea),
    )
  } catch {
    return null
  }
}

function writeWindowBounds(bounds: Electron.Rectangle): void {
  const serialized = JSON.stringify(bounds)
  void fs
    .mkdir(path.dirname(stateFilePath()), { recursive: true })
    .then(() => fs.writeFile(stateFilePath(), serialized, 'utf8'))
    .catch(() => undefined)
}

function scheduleSaveBounds(window: BrowserWindow): void {
  if (boundsTimer) clearTimeout(boundsTimer)
  boundsTimer = setTimeout(() => {
    boundsTimer = undefined
    const bounds = captureWindowBounds(window)
    if (bounds) writeWindowBounds(bounds)
  }, 250)
}

function flushSaveBounds(window: BrowserWindow): void {
  if (boundsTimer) {
    clearTimeout(boundsTimer)
    boundsTimer = undefined
  }
  const bounds = captureWindowBounds(window)
  if (bounds) writeWindowBounds(bounds)
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character] ?? character,
  )
}

function showRendererFailure(errorDescription: string, retryUrl: string): void {
  const window = mainWindow
  if (!window || window.isDestroyed() || rendererFailurePageLoading) return
  rendererFailurePageLoading = true
  const html = `<header style="height:56px;app-region:drag;-webkit-app-region:drag"></header><main style="font:16px sans-serif;padding:32px"><h1>Bee Game Studio is unavailable</h1>${errorDescription ? `<p>${escapeHtml(errorDescription)}</p>` : ''}<p>Check the local server or network, then retry.</p><a href="${escapeHtml(retryUrl)}">Retry</a></main>`
  const page = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
  void window
    .loadURL(page)
    .catch(() => undefined)
    .finally(() => {
      rendererFailurePageLoading = false
      if (!window.isDestroyed()) window.show()
    })
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    !isTrustedRendererUrl(senderUrl, trustedOrigins)
  ) {
    throw new Error('Untrusted renderer IPC sender.')
  }
}

function deliverOAuthCallback(): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    !mainWindow.webContents.getURL() ||
    !oauthListenerReady ||
    !pendingOAuthCallback
  )
    return
  try {
    mainWindow.webContents.send('oauth-callback', pendingOAuthCallback)
    pendingOAuthCallback = null
  } catch {
    // Keep the one-time callback queued if the renderer disappeared between
    // the readiness check and delivery.
  }
}

function queueOAuthCallback(value: string): void {
  const callback = parseOAuthCallbackUrl(value)
  if (!callback) return
  pendingOAuthCallback = callback.toString()
  deliverOAuthCallback()
}

function deliverDesktopCommand(): void {
  if (!mainWindow || mainWindow.isDestroyed() || !desktopCommandsReady || !pendingDesktopCommand) return
  mainWindow.webContents.send('desktop-command', pendingDesktopCommand)
  pendingDesktopCommand = null
}

function configureMenu(): void {
  const chinese = app.getLocale().startsWith('zh')
  const send = (command: NonNullable<typeof pendingDesktopCommand>) => {
    pendingDesktopCommand = command
    if (!mainWindow) void createWindow()
    else { mainWindow.show(); mainWindow.focus(); deliverDesktopCommand() }
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: chinese ? '文件' : 'File', submenu: [
      { label: chinese ? '新建项目' : 'New Project', accelerator: 'CommandOrControl+N', click: () => send('new-project') },
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { role: 'editMenu' },
    { label: chinese ? '显示' : 'View', submenu: [
      { label: chinese ? '切换项目侧栏' : 'Toggle Sidebar', accelerator: 'CommandOrControl+B', click: () => send('toggle-sidebar') },
      { label: chinese ? '聚焦输入框' : 'Focus Input', accelerator: 'CommandOrControl+L', click: () => send('focus-input') },
      { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ]))
}

function configureIpc(): void {
  ipcMain.handle('desktop-commands-ready', event => {
    assertTrustedSender(event)
    desktopCommandsReady = true
    deliverDesktopCommand()
  })
  ipcMain.handle('set-theme', (event, isDark: unknown) => {
    assertTrustedSender(event)
    if (typeof isDark !== 'boolean') throw new Error('Theme must be a boolean.')
    nativeTheme.themeSource = isDark ? 'dark' : 'light'
    if (process.platform !== 'darwin') {
      mainWindow?.setTitleBarOverlay({
        color: isDark ? '#0c0d10' : '#ffffff',
        symbolColor: isDark ? '#f4f4f5' : '#181a1f',
        height: 56,
      })
    }
  })
  ipcMain.handle('oauth-listener-ready', event => {
    assertTrustedSender(event)
    oauthListenerReady = true
    deliverOAuthCallback()
  })
  ipcMain.handle('open-external', (event, value: unknown) => {
    assertTrustedSender(event)
    if (typeof value !== 'string' || !isAllowedExternalUrl(value))
      throw new Error('Only safe HTTP(S) URLs can be opened.')
    return shell.openExternal(value)
  })
}

function configureNavigation(): void {
  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  )
  defaultSession.on('will-download', (_event, item) => {
    const filename = sanitizeFileName(item.getFilename())
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), filename),
      buttonLabel: 'Save',
    })
  })
}

async function createWindow(): Promise<void> {
  if (mainWindow || creatingWindow) return
  creatingWindow = true
  try {
    const savedBounds = await readWindowBounds()
    const defaultBounds =
      clampWindowBounds(DEFAULT_WINDOW_BOUNDS, [
        screen.getPrimaryDisplay().workArea,
      ]) ?? DEFAULT_WINDOW_BOUNDS
    mainWindow = new BrowserWindow({
      ...(savedBounds ?? defaultBounds),
      minWidth: MIN_WINDOW_WIDTH,
      minHeight: MIN_WINDOW_HEIGHT,
      show: false,
      icon: appIconPath(),
      titleBarStyle: 'hidden',
      ...(process.platform === 'darwin'
        ? { trafficLightPosition: { x: 16, y: 22 } }
        : { titleBarOverlay: { color: '#0c0d10', symbolColor: '#f4f4f5', height: 56 } }),
      backgroundColor: '#090a0c',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    mainWindow.on('move', () => scheduleSaveBounds(mainWindow!))
    mainWindow.on('resize', () => scheduleSaveBounds(mainWindow!))
    mainWindow.on('close', () => {
      if (mainWindow) flushSaveBounds(mainWindow)
    })
    mainWindow.on('closed', () => {
      mainWindow = null
      desktopCommandsReady = false
    })
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, trustedOrigins)) {
        event.preventDefault()
        if (isAllowedExternalUrl(url)) void shell.openExternal(url)
      }
    })
    mainWindow.webContents.on('did-navigate', () => {
      oauthListenerReady = false
      desktopCommandsReady = false
    })
    mainWindow.webContents.on('render-process-gone', () => {
      oauthListenerReady = false
      desktopCommandsReady = false
    })
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.show()
    })
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return
        showRendererFailure(errorDescription, validatedURL || rendererUrl)
      },
    )
    try {
      await mainWindow.loadURL(rendererUrl)
    } catch {
      // did-fail-load owns the visible retry page for rejected navigations.
    }
  } finally { creatingWindow = false }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  queueOAuthCallback(
    process.argv.find(value => value.startsWith('beegame://')) ?? '',
  )
  app.on('second-instance', (_event, argv) => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.focus()
    queueOAuthCallback(argv.find(value => value.startsWith('beegame://')) ?? '')
  })
  app.on('open-url', (event, value) => {
    event.preventDefault()
    queueOAuthCallback(value)
  })
  void app
    .whenReady()
    .then(async () => {
      app.setAboutPanelOptions({
        applicationName: 'Bee Game Studio',
        applicationVersion: app.getVersion(),
        iconPath: appIconPath(),
      })
      rendererUrl = getRendererUrl(app.isPackaged)
      oauthListenerReady = false
      trustedOrigins = getTrustedOrigins(rendererUrl)
      app.setAsDefaultProtocolClient('beegame')
      if (app.isPackaged && rendererUrl === DEV_RENDERER_URL) {
        protocol.handle('http', request => serveBundledRenderer(
          request, path.join(process.resourcesPath, 'frontend'),
          (input, init) => net.fetch(input, init),
        ))
      }
      configureIpc()
      configureNavigation()
      configureMenu()
      await createWindow()
      app.on('activate', () => {
        if (!mainWindow) void createWindow()
      })
    })
    .catch(error => {
      dialog.showErrorBox(
        'Bee Game Studio could not start',
        error instanceof Error ? error.message : String(error),
      )
      app.quit()
    })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
