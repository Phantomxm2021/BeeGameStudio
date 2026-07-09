import {
  createBeeGameSkillsApp,
  LocalBeeGameSkillsRepository,
  type BeeGameSkillsUserContext,
} from '@claude-code-best/beegame-skills-core'
import {
  createBeeGameSkillsAuthContext,
  createConfiguredSkillsUserResolver,
  hasBeeGameSkillsPermission,
  type SkillsUserResolver,
} from './auth'

export type BeeGameSkillsServerAppOptions = {
  currentUser?: BeeGameSkillsUserContext
  currentUserResolver?: SkillsUserResolver
  dataDir?: string
  serviceToken?: string
}

export function createBeeGameSkillsServerApp(
  options: BeeGameSkillsServerAppOptions = {},
) {
  const authContext = createBeeGameSkillsAuthContext({
    currentUser: options.currentUser,
    currentUserResolver: options.currentUserResolver ?? createConfiguredSkillsUserResolver(),
  })
  return createBeeGameSkillsApp({
    repository: new LocalBeeGameSkillsRepository({
      ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    }),
    getCurrentUser: authContext.getCurrentUser,
    hasPermission: hasBeeGameSkillsPermission,
    requireRequestUser: !options.currentUser,
    resolveRequestUser: authContext.resolveRequestUser,
    serviceName: 'beegame-skills',
    serviceToken: options.serviceToken ?? process.env.BEEGAME_SKILLS_SERVICE_TOKEN,
  })
}
