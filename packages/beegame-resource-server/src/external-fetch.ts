import { createTLSAwareFetch } from '../../../src/utils/mtls.js'

export type { TLSAwareFetch as ResourceServerFetch } from '../../../src/utils/mtls.js'

export const createResourceServerFetch = createTLSAwareFetch
