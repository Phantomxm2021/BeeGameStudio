export { resolveUnityNavigationAction, wheelPixels } from './navigation'

export function keyboardLabels(platform: string) {
  const apple = /Mac|iPhone|iPad|iPod/i.test(platform)
  return { apple, modifier: apple ? '⌘' : 'Ctrl', control: apple ? '⌃' : 'Ctrl', alt: apple ? '⌥' : 'Alt', altName: apple ? 'Option' : 'Alt', shift: apple ? '⇧' : 'Shift', delete: apple ? '⌫' : 'Del', rename: apple ? '↩' : 'F2' }
}
export function currentKeyboardLabels() {
  if (typeof navigator === 'undefined') return keyboardLabels('')
  const clientPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
  return keyboardLabels(clientPlatform || navigator.platform || navigator.userAgent)
}
