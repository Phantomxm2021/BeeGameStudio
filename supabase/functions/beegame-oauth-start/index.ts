type OAuthProvider = 'github' | 'google' | 'facebook' | 'x' | 'discord'

type StartRequest = {
  provider?: string
  invitationCode?: string
  redirectTo?: string
  codeChallenge?: string
  codeChallengeMethod?: string
  scopes?: string
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const apiKey = serviceRoleKey || anonKey
  if (!supabaseUrl || !apiKey) {
    return json({ error: 'Supabase function is not configured' }, 500)
  }

  let body: StartRequest
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON body' }, 400)
  }

  const provider = normalizeProvider(body.provider)
  const invitationCode = body.invitationCode?.trim() ?? ''
  const redirectTo = body.redirectTo?.trim() ?? ''
  const codeChallenge = body.codeChallenge?.trim() ?? ''
  const codeChallengeMethod = body.codeChallengeMethod?.trim() || 'S256'
  if (!provider) return json({ error: 'Unsupported OAuth provider' }, 400)
  if (!invitationCode) return json({ error: 'Invitation code is required' }, 400)
  if (!redirectTo) return json({ error: 'redirectTo is required' }, 400)
  if (!codeChallenge) return json({ error: 'codeChallenge is required' }, 400)

  const nonceResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/beegame_create_oauth_invitation_nonce`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_code: invitationCode }),
  })
  if (!nonceResponse.ok) {
    return json({ error: await readError(nonceResponse) }, 400)
  }
  const nonceValue = await nonceResponse.json()
  const nonce = typeof nonceValue === 'string' ? nonceValue : ''
  if (!nonce) return json({ error: 'Invitation nonce was not created' }, 500)

  const authorizeUrl = new URL(`${supabaseUrl}/auth/v1/authorize`)
  authorizeUrl.searchParams.set('provider', provider)
  authorizeUrl.searchParams.set('redirect_to', redirectTo)
  authorizeUrl.searchParams.set('flow_type', 'pkce')
  authorizeUrl.searchParams.set('code_challenge', codeChallenge)
  authorizeUrl.searchParams.set('code_challenge_method', codeChallengeMethod)
  if (body.scopes?.trim()) {
    authorizeUrl.searchParams.set('scopes', body.scopes.trim())
  }

  return json({ url: authorizeUrl.toString(), nonce })
})

function normalizeProvider(value: string | undefined): OAuthProvider | undefined {
  if (
    value === 'github' ||
    value === 'google' ||
    value === 'facebook' ||
    value === 'x' ||
    value === 'discord'
  ) {
    return value
  }
  return undefined
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json',
    },
  })
}

async function readError(response: Response): Promise<string> {
  try {
    const value = await response.json()
    if (typeof value?.message === 'string') return value.message
    if (typeof value?.error === 'string') return value.error
    return JSON.stringify(value)
  } catch {
    return response.statusText || 'Invitation validation failed'
  }
}
