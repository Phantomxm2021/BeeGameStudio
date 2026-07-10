import {
  createPinnedUndiciDispatcher,
  resolveApprovedOutboundTarget,
} from '@bee-game-studio/security-core'

export type UploadResult = {
  id: string
  url: string
  expiresAt: string
}

export type UploadParams = {
  html: string
  token: string
  uploadUrl: string
  hash?: string
  ttl?: 7 | 30
}

async function closeDispatcher(dispatcher: {
  close?: () => Promise<void>
  destroy?: () => void
}): Promise<void> {
  if (dispatcher.close) {
    await dispatcher.close()
  } else {
    dispatcher.destroy?.()
  }
}

export async function uploadArtifact(
  params: UploadParams,
): Promise<UploadResult> {
  const url = new URL(params.uploadUrl)
  if (params.hash) url.searchParams.set('hash', params.hash)
  if (params.ttl) url.searchParams.set('ttl', String(params.ttl))

  const target = await resolveApprovedOutboundTarget(url.toString())
  if (!target) throw new Error('Outbound URL is not permitted')
  const dispatcher = createPinnedUndiciDispatcher(target)

  try {
    const response = await fetch(target.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.token}`,
        'Content-Type': 'text/html',
      },
      body: params.html,
      redirect: 'error',
      dispatcher,
    } as RequestInit)

    try {
      // Deno Deploy proxy flattens upstream status to 200; the Worker embeds the
      // real error in the body as `{ "error": "<code>" }`. Always parse body first.
      const text = await response.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error(
          `Artifact upload failed: HTTP ${response.status} (non-JSON body)`,
        )
      }

      if (parsed && typeof parsed === 'object' && 'error' in parsed) {
        const code = (parsed as { error: unknown }).error
        throw new Error(`Artifact upload failed: ${String(code)}`)
      }

      const data = parsed as Partial<UploadResult>
      if (
        typeof data.id !== 'string' ||
        typeof data.url !== 'string' ||
        typeof data.expiresAt !== 'string'
      ) {
        throw new Error(
          `Artifact upload returned malformed body: ${text.slice(0, 200)}`,
        )
      }
      return { id: data.id, url: data.url, expiresAt: data.expiresAt }
    } finally {
      await response.body?.cancel().catch(() => {})
    }
  } finally {
    await closeDispatcher(dispatcher)
  }
}
