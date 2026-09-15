export function keyboardLabels(platform: string) {
  const apple = /Mac|iPhone|iPad|iPod/i.test(platform)
  return { apple, modifier: apple ? '⌘' : 'Ctrl', alt: apple ? '⌥' : 'Alt', altName: apple ? 'Option' : 'Alt', shift: apple ? '⇧' : 'Shift', delete: apple ? '⌫' : 'Del' }
}
export function currentKeyboardLabels() {
  return keyboardLabels(typeof navigator === 'undefined' ? '' : navigator.platform)
}
