/** The host Preview and the implementation task describe the same security boundary. */
export const PREVIEW_IFRAME_SANDBOX = 'allow-forms allow-pointer-lock allow-popups allow-scripts'

export const PREVIEW_ENVIRONMENT = {
  embedding: 'sandboxed-iframe',
  sandbox: PREVIEW_IFRAME_SANDBOX,
  origin: 'opaque',
  assetBase: 'Preview may be hosted below /previews/<capability>/. Root-absolute /assets or /content URLs escape that namespace; resolve runtime URLs from the served document/module base.',
  storage: 'Native localStorage/sessionStorage can throw in this opaque frame. Production Preview provides async createGameStorage() in the optional BGS consumer (--api): await getItem/setItem/removeItem. Preview saves are user/project-isolated and separate from deployment localStorage. Await persistence errors, not a silent memory fallback. Existing games need explicit integration; development Preview has no persistent save API. Measurement saves are disposable, not user Preview saves.',
  verification: 'A standalone tab is not equivalent to this embedded environment. Inspect the game in this sandbox as well as its deployment target; preserve isolation.',
} as const
