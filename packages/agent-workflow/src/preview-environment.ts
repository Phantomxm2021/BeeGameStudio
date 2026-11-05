/** The host Preview and the implementation task describe the same security boundary. */
export const PREVIEW_IFRAME_SANDBOX = 'allow-forms allow-pointer-lock allow-popups allow-scripts'

export const PREVIEW_ENVIRONMENT = {
  embedding: 'sandboxed-iframe',
  sandbox: PREVIEW_IFRAME_SANDBOX,
  origin: 'opaque',
  assetBase: 'Preview may be hosted below /previews/<capability>/. Root-absolute /assets or /content URLs escape that namespace; resolve runtime URLs from the served document/module base.',
  storage: 'Native localStorage/sessionStorage can throw in this opaque frame. Production Preview provides async createGameStorage() in the optional BGS consumer (--api): await getItem/setItem/removeItem. Preview saves are user/project-isolated and separate from deployment localStorage. Await persistence errors, not a silent memory fallback. Existing games need explicit integration; development Preview has no persistent save API. Publication checks use disposable saves, not user Preview saves.',
  verification: 'A standalone tab and this sandboxed opaque iframe have different origin and storage behavior.',
} as const

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!)

/** The user Preview shell and publication capture share the same sandbox. */
export function previewTestHostDocument(source: URL) {
  return { body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bee Game Studio Preview Test</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe id="beegame-preview" title="Game preview" sandbox="${PREVIEW_IFRAME_SANDBOX}" src="${escapeHtml(source.href)}"></iframe></body></html>`,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; frame-src ${source.origin}; frame-ancestors 'none'` } }
}
