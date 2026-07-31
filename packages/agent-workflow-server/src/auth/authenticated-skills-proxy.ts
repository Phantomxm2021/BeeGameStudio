import type {
  BeeGameSkillsConfig,
} from '@bee-game-studio/beegame-skills-core/config'
import {
  proxyBeeGameSkillsRequest,
} from '@bee-game-studio/beegame-skills-core/client'
import type { BeeGameSessionAuth } from './session-routes'
import {
  authenticationRequiredResponse,
  createAuthenticatedServiceRequest,
} from './authenticated-service-request'

type BeeGameSkillsProxy = typeof proxyBeeGameSkillsRequest

export async function proxyAuthenticatedSkillsRequest(
  request: Request,
  skillsConfig: BeeGameSkillsConfig,
  path: string,
  sessionAuth?: BeeGameSessionAuth,
  proxyImpl: BeeGameSkillsProxy = proxyBeeGameSkillsRequest,
): Promise<Response> {
  const authenticatedRequest = await createAuthenticatedServiceRequest(
    request,
    sessionAuth,
  )
  if (!authenticatedRequest) return authenticationRequiredResponse()
  return proxyImpl(skillsConfig, authenticatedRequest, path)
}
