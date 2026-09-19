/** Form controls and floating UI own their keys; never turn them into scene commands. */
export function isSceneControl(target: Element | null, root?: Element): boolean {
  const control = target?.closest('[role="dialog"],[role="menu"],[role="listbox"],[role="slider"],[role="tablist"],[data-scene-control],button')
  return Boolean(control && (!root || root.contains(control)))
}
