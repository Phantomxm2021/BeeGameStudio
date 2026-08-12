const SAFE_INHERITED_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'NODE_ENV',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const

export function getSafeRuntimeProcessEnvironment(): Record<string, string> {
  return Object.fromEntries(
    SAFE_INHERITED_ENV_KEYS.flatMap(key => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
}
