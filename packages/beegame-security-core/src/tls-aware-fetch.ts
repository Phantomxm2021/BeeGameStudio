import { readFileSync } from 'node:fs'
import { rootCertificates } from 'node:tls'
import { Agent } from 'undici'

export type TLSAwareFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

type TLSConfig = {
  cert?: string
  key?: string
  passphrase?: string
  ca?: string | string[] | Buffer
}

export type TLSAwareFetchOptions = {
  tls?: TLSConfig
  dispatcher?: unknown
}

type TransportRequestInit = RequestInit & TLSAwareFetchOptions

function readConfiguredFile(path: string | undefined): string | undefined {
  return path ? readFileSync(path, 'utf8') : undefined
}

export function getTLSFetchOptions(): TLSAwareFetchOptions {
  const cert = readConfiguredFile(process.env.CLAUDE_CODE_CLIENT_CERT)
  const key = readConfiguredFile(process.env.CLAUDE_CODE_CLIENT_KEY)
  const passphrase = process.env.CLAUDE_CODE_CLIENT_KEY_PASSPHRASE
  const extraCA = readConfiguredFile(process.env.NODE_EXTRA_CA_CERTS)
  if (!cert && !key && !passphrase && !extraCA) return {}

  const tls: TLSConfig = {
    ...(cert ? { cert } : {}),
    ...(key ? { key } : {}),
    ...(passphrase ? { passphrase } : {}),
    ...(extraCA ? { ca: [...rootCertificates, extraCA] } : {}),
  }
  if (typeof Bun !== 'undefined') return { tls }
  return {
    dispatcher: new Agent({
      connect: {
        cert: tls.cert,
        key: tls.key,
        passphrase: tls.passphrase,
        ...(tls.ca ? { ca: tls.ca } : {}),
      },
      pipelining: 1,
    }),
  }
}

export function createTLSAwareFetch(
  baseFetch: TLSAwareFetch = globalThis.fetch.bind(globalThis),
  tlsOptions: TLSAwareFetchOptions = getTLSFetchOptions(),
): TLSAwareFetch {
  const transportOptions: TLSAwareFetchOptions = {
    ...(tlsOptions.dispatcher ? { dispatcher: tlsOptions.dispatcher } : {}),
    ...(tlsOptions.tls ? { tls: tlsOptions.tls } : {}),
  }
  if (Object.keys(transportOptions).length === 0) return baseFetch
  return (input, init) =>
    baseFetch(input, { ...init, ...transportOptions } as TransportRequestInit)
}
