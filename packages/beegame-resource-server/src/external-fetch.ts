import { createTLSAwareFetch } from '@bee-game-studio/security-core'

export type { TLSAwareFetch as ResourceServerFetch } from '@bee-game-studio/security-core'

export const createResourceServerFetch = createTLSAwareFetch
