// Only this built-in, in-memory function hook is a protocol requirement.
// Settings/plugin/frontmatter hooks cannot create executable function hooks.
export const STRUCTURED_OUTPUT_ENFORCEMENT_HOOK_ID = 'internal:structured-output-enforcement'

export function isStructuredOutputProtocolHook(hook: { type: string; id?: string }): boolean {
  return hook.type === 'function' && hook.id === STRUCTURED_OUTPUT_ENFORCEMENT_HOOK_ID
}
