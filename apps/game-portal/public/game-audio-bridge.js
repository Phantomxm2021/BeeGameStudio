/** Optional integration for games that want the portal's sound button. */
window.BeeGamePortalAudio = {
  connect(setMuted) {
    if (window.parent === window || typeof setMuted !== 'function')
      return () => {}
    let portalOrigin
    try {
      portalOrigin = new URL(document.referrer).origin
    } catch {
      return () => {}
    }
    const onMessage = event => {
      if (event.source !== window.parent || event.origin !== portalOrigin)
        return
      if (
        event.data?.type === 'beegame:set-muted' &&
        event.data.version === 1 &&
        typeof event.data.muted === 'boolean'
      ) {
        setMuted(event.data.muted)
      }
    }
    window.addEventListener('message', onMessage)
    window.parent.postMessage(
      { type: 'beegame:audio-control-ready', version: 1 },
      portalOrigin,
    )
    return () => window.removeEventListener('message', onMessage)
  },
}
