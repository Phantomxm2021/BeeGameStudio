import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { sanitizePath } from '../../../src/utils/sessionStoragePortable'

/** Upstream cache location for an explicitly selected public CLI session.
 * Grant reads to this directory only, not its enclosing transcripts/config. */
export function standardCliCache(workspace: string, session: string, env: Record<string, string>) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(session)) throw Error('Expected ordinary native session UUID')
  return resolve(env.BEEGAME_CONFIG_DIR ?? env.CLAUDE_CONFIG_DIR ?? resolve(homedir(), '.claude'),
    'projects', sanitizePath(workspace), session, 'tool-results')
}
