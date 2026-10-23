const SAFE_INHERITED_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const

export function getSafeRuntimeProcessEnvironment(): Record<string, string> {
  // The BGS server's mode is not the generated project's build mode. Inheriting
  // development makes Vite production builds retain development-only code.
  // Project commands can still explicitly select their own NODE_ENV.
  return Object.fromEntries(
    SAFE_INHERITED_ENV_KEYS.flatMap(key => {
      const value = process.env[key]
      return value === undefined ? [] : [[key, value]]
    }),
  )
}
