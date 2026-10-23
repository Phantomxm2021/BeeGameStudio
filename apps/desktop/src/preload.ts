import { contextBridge, ipcRenderer } from 'electron'

type OAuthCallbackHandler = (callbackUrl: string) => void | Promise<void>

function validateExternalUrl(value: string): string {
  const url = new URL(value)
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password ||
    value.length > 4096
  ) {
    throw new Error('Only safe HTTP(S) URLs can be opened.')
  }
  return url.toString()
}

const bridge = {
  isDesktop: true as const,
  openExternal: (url: string) =>
    ipcRenderer.invoke(
      'open-external',
      validateExternalUrl(url),
    ) as Promise<void>,
  onOAuthCallback: (handler: OAuthCallbackHandler) => {
    const listener = (_event: Electron.IpcRendererEvent, callbackUrl: string) =>
      void handler(callbackUrl)
    ipcRenderer.on('oauth-callback', listener)
    void ipcRenderer.invoke('oauth-listener-ready').catch((error: unknown) => {
      console.error('Unable to register the OAuth callback listener.', error)
    })
    return () => ipcRenderer.removeListener('oauth-callback', listener)
  },
}

contextBridge.exposeInMainWorld('beeGameDesktop', bridge)
