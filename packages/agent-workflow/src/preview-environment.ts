/** The host Preview and the implementation task describe the same security boundary. */
export const PREVIEW_IFRAME_SANDBOX = 'allow-forms allow-pointer-lock allow-popups allow-scripts'

export const PREVIEW_ENVIRONMENT = {
  embedding: 'sandboxed-iframe',
  sandbox: PREVIEW_IFRAME_SANDBOX,
  origin: 'opaque',
  storage: 'localStorage/sessionStorage access can throw; use a safe fallback when unavailable',
  verification: 'A standalone tab is not equivalent to this embedded environment. Inspect the game in this sandbox as well as its deployment target; preserve isolation.',
} as const
