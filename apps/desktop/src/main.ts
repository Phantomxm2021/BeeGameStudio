import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  session,
  shell,
  screen,
} from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getRendererUrl, getTrustedOrigins } from './config'
import {
  captureWindowBounds,
  clampWindowBounds,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  parseOAuthCallbackUrl,
  sanitizeFileName,
} from './security'

let mainWindow: BrowserWindow | null = null
let rendererUrl = ''
let trustedOrigins = new Set<string>()
let pendingOAuthCallback: string | null = null
let oauthListenerReady = false
let boundsTimer: NodeJS.Timeout | undefined
let rendererFailurePageLoading = false

const DEFAULT_WINDOW_BOUNDS = { x: 0, y: 0, width: 1440, height: 900 }
const MIN_WINDOW_WIDTH = 720
const MIN_WINDOW_HEIGHT = 480

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
  const html = `<main style="font:16px sans-serif;padding:32px"><h1>Bee Game Studio is unavailable</h1>${errorDescription ? `<p>${escapeHtml(errorDescription)}</p>` : ''}<p>Check the local server or network, then retry.</p><a href="${escapeHtml(retryUrl)}">Retry</a></main>`
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

function configureIpc(): void {
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
  })
  mainWindow.webContents.on('render-process-gone', () => {
    oauthListenerReady = false
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
      rendererUrl = getRendererUrl(app.isPackaged)
      oauthListenerReady = false
      trustedOrigins = getTrustedOrigins(rendererUrl)
      app.setAsDefaultProtocolClient('beegame')
      configureIpc()
      configureNavigation()
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
