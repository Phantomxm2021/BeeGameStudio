export type BeeGameSupabaseUser = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type BeeGameSupabaseSession = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: BeeGameSupabaseUser;
};

export class SupabaseAuthApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'SupabaseAuthApiError';
    this.code = options.code ?? '';
    this.status = options.status ?? 0;
  }
}

export type SupabasePasswordSignInInput = {
  email: string;
  password: string;
};

export type SupabasePasswordSignUpInput = SupabasePasswordSignInInput & {
  displayName: string;
  invitationCode?: string;
};

export type SupabaseOAuthProvider =
  | 'github'
  | 'google'
  | 'facebook'
  | 'x'
  | 'discord';

export type SupabaseOAuthSignInOptions = {
  invitationCode?: string;
};

const SESSION_STORAGE_KEY = 'beegame_supabase_session';
const OAUTH_PKCE_STORAGE_KEY = 'beegame_supabase_oauth_pkce';
const OAUTH_START_FUNCTION_PATH = '/functions/v1/beegame-oauth-start';
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
let pendingRedirectConsumption: {
  key: string;
  promise: Promise<boolean>;
} | null = null;
let pendingSessionInitialization: Promise<BeeGameSupabaseSession | null> | null = null;
let pendingSessionRefresh: Promise<BeeGameSupabaseSession | null> | null = null;
let httpOnlySessionUser: BeeGameSupabaseUser | null = null;

const getSupabaseUrl = (): string => String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const getSupabaseAnonKey = (): string => String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const getSupabaseAvatarBucket = (): string => String(import.meta.env.VITE_SUPABASE_AVATAR_BUCKET ?? 'avatars').trim() || 'avatars';

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseAccessToken(): string {
  if (isHttpOnlySessionsEnabled()) return '';
  const session = getStoredSupabaseSession();
  if (!session) return '';
  if (session.expiresAt <= Date.now()) {
    return '';
  }
  return session.accessToken;
}

export async function getValidSupabaseAccessToken(): Promise<string> {
  if (isHttpOnlySessionsEnabled()) return '';
  const token = getSupabaseAccessToken();
  if (token) return token;
  const session = getStoredSupabaseSession();
  if (!session?.refreshToken) return '';
  const refreshed = await refreshSupabaseSession();
  return refreshed?.accessToken ?? '';
}

export function getSupabaseSessionUser(): BeeGameSupabaseUser | null {
  if (isHttpOnlySessionsEnabled()) return httpOnlySessionUser;
  return getStoredSupabaseSession()?.user ?? null;
}

export async function signInWithSupabasePassword(
  input: SupabasePasswordSignInInput,
): Promise<BeeGameSupabaseSession> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
    }),
  });
  if (!response.ok) {
    throw await readSupabaseAuthError(response);
  }
  const session = toSupabaseSession(await response.json());
  await persistSupabaseSession(session);
  return session;
}

export async function signUpWithSupabasePassword(
  input: SupabasePasswordSignUpInput,
): Promise<BeeGameSupabaseSession | null> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/signup`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: input.email.trim(),
      password: input.password,
      data: {
        display_name: input.displayName.trim(),
        ...(input.invitationCode?.trim()
          ? { beegame_invitation_code: input.invitationCode.trim() }
          : {}),
      },
    }),
  });
  if (!response.ok) {
    throw await readSupabaseAuthError(response);
  }
  const value = await response.json();
  if (!isRecord(value) || typeof value.access_token !== 'string') return null;
  const session = toSupabaseSession(value);
  await persistSupabaseSession(session);
  return session;
}

export async function sendSupabasePasswordReset(email: string): Promise<void> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/recover`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: email.trim(),
      redirect_to: window.location.origin,
    }),
  });
  if (!response.ok) {
    throw await readSupabaseAuthError(response);
  }
}

export async function updateSupabaseAvatarUrl(avatarUrl: string): Promise<void> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const accessToken = getSupabaseAccessToken();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  if (!accessToken) {
    throw new Error('Please sign in again before updating your profile.');
  }
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        avatar_url: avatarUrl.trim(),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }
}

export async function uploadSupabaseAvatarImage(file: File): Promise<string> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  const accessToken = getSupabaseAccessToken();
  const session = getStoredSupabaseSession();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  if (!accessToken || !session) {
    throw new Error('Please sign in again before uploading your avatar.');
  }
  if (!ALLOWED_AVATAR_TYPES.has(file.type.toLowerCase())) {
    throw new Error('Avatar must be a PNG, JPEG, or WebP image.');
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Avatar must be 5 MB or smaller.');
  }
  const bucket = getSupabaseAvatarBucket();
  const objectPath = `avatars/${encodeURIComponent(session.user.id)}/${Date.now()}-${slugifyFileName(file.name)}`;
  const response = await fetch(
    `${trimTrailingSlash(supabaseUrl)}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`,
    {
      method: 'PUT',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${accessToken}`,
        'content-type': file.type || 'application/octet-stream',
        'x-upsert': 'true',
      },
      body: file,
    },
  );
  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }
  return `${trimTrailingSlash(supabaseUrl)}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
}

export async function signInWithSupabaseOAuth(
  provider: SupabaseOAuthProvider,
  options: SupabaseOAuthSignInOptions = {},
): Promise<void> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const codeVerifier = createPkceCodeVerifier();
  const codeChallenge = await createPkceCodeChallenge(codeVerifier);
  const invitationCode = options.invitationCode?.trim() || '';
  const pkceContext: Record<string, unknown> = {
    provider,
    codeVerifier,
    createdAt: Date.now(),
  };
  let redirectUrl: string;
  if (invitationCode) {
    const response = await fetch(`${trimTrailingSlash(supabaseUrl)}${OAUTH_START_FUNCTION_PATH}`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider,
        invitationCode,
        redirectTo: window.location.origin,
        codeChallenge,
        codeChallengeMethod: 'S256',
        ...(provider === 'discord' ? { scopes: 'identify email' } : {}),
      }),
    });
    if (!response.ok) {
      throw new Error(await readSupabaseError(response));
    }
    const value = await response.json();
    if (!isRecord(value) || typeof value.url !== 'string') {
      throw new Error('OAuth invitation start did not return a redirect URL.');
    }
    redirectUrl = validateOAuthRedirectUrl(value.url);
    if (typeof value.nonce === 'string' && value.nonce.trim()) {
      pkceContext.invitationNonce = value.nonce.trim();
    }
  } else {
    const url = new URL(`${trimTrailingSlash(supabaseUrl)}/auth/v1/authorize`);
    url.searchParams.set('provider', provider);
    url.searchParams.set('redirect_to', window.location.origin);
    url.searchParams.set('flow_type', 'pkce');
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    if (provider === 'discord') {
      url.searchParams.set('scopes', 'identify email');
    }
    redirectUrl = url.toString();
  }
  sessionStorage.setItem(OAUTH_PKCE_STORAGE_KEY, JSON.stringify(pkceContext));
  window.location.assign(redirectUrl);
}

export async function consumeSupabaseRedirectSession(): Promise<boolean> {
  const callbackKey = getOAuthCallbackKey();
  if (!callbackKey) return false;
  if (pendingRedirectConsumption?.key === callbackKey) {
    return pendingRedirectConsumption.promise;
  }
  const promise = consumeSupabaseRedirectSessionOnce()
    .finally(() => {
      if (pendingRedirectConsumption?.promise === promise) {
        pendingRedirectConsumption = null;
      }
    });
  pendingRedirectConsumption = { key: callbackKey, promise };
  return promise;
}

async function consumeSupabaseRedirectSessionOnce(): Promise<boolean> {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);
  const pkce = readStoredPkceContext();
  const error = readOAuthError(hashParams) ?? readOAuthError(searchParams);
  if (error) {
    clearOAuthCallbackUrl();
    sessionStorage.removeItem(OAUTH_PKCE_STORAGE_KEY);
    throw new Error(toUserFacingOAuthError(error, pkce?.provider));
  }
  const accessToken = hashParams.get('access_token')?.trim() || '';
  if (accessToken) {
    const expiresIn = Number.parseInt(hashParams.get('expires_in') || '3600', 10);
    await persistSupabaseSession({
      accessToken,
      refreshToken: hashParams.get('refresh_token') || undefined,
      expiresAt: Date.now() + Math.max(0, (Number.isFinite(expiresIn) ? expiresIn : 3600) - 30) * 1000,
      user: { id: 'oauth' },
    });
    await redeemOAuthInvitationNonce(pkce?.invitationNonce, accessToken);
    clearOAuthCallbackUrl();
    return true;
  }
  const authCode = searchParams.get('code')?.trim() || '';
  if (!authCode) return false;
  const session = await exchangeSupabaseOAuthCode(authCode);
  await redeemOAuthInvitationNonce(pkce?.invitationNonce, session.accessToken);
  clearOAuthCallbackUrl();
  return true;
}

async function redeemOAuthInvitationNonce(
  invitationNonce: unknown,
  accessToken: string,
): Promise<void> {
  const nonce = typeof invitationNonce === 'string' ? invitationNonce.trim() : '';
  if (!nonce) return;
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) return;
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/rest/v1/rpc/beegame_redeem_oauth_invitation`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_nonce: nonce }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }
}

export async function hydrateSupabaseSessionUser(): Promise<BeeGameSupabaseSession | null> {
  const session = getStoredSupabaseSession();
  if (isHttpOnlySessionsEnabled() && !session) {
    const response = await fetch(buildSameOriginApiUrl('/api/auth/session'), {
      credentials: 'include',
    });
    if (!response.ok) {
      if (response.status === 404) {
        throw new SupabaseAuthApiError('BeeGame secure session configuration is inconsistent.', {
          code: 'secure_session_not_configured',
          status: response.status,
        });
      }
      return null;
    }
    const cookieSession = toCookieSession(await response.json());
    httpOnlySessionUser = cookieSession.user;
    return cookieSession;
  }
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!session || !supabaseUrl || !anonKey) return session;
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${session.accessToken}`,
    },
  });
  if (!response.ok) return session;
  const value = await response.json() as unknown;
  if (!isRecord(value)) return session;
  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim()
    : session.user.id;
  const hydrated: BeeGameSupabaseSession = {
    ...session,
    user: {
      id,
      email: readUserEmail(value) ?? session.user.email,
      displayName: readUserDisplayName(value) ?? session.user.displayName,
      avatarUrl: readUserAvatarUrl(value) ?? session.user.avatarUrl,
    },
  };
  await persistSupabaseSession(hydrated);
  return hydrated;
}

/**
 * Restore the browser authentication boundary exactly once during concurrent
 * React mounts. HttpOnly mode restores the server cookie; legacy mode restores
 * the browser session. Callers must not infer authentication from token
 * visibility because HttpOnly access tokens are intentionally unreadable.
 */
export function initializeSupabaseSession(): Promise<BeeGameSupabaseSession | null> {
  if (pendingSessionInitialization) return pendingSessionInitialization;
  const initialization = (async () => {
    await consumeSupabaseRedirectSession();
    return hydrateSupabaseSessionUser();
  })().finally(() => {
    if (pendingSessionInitialization === initialization) {
      pendingSessionInitialization = null;
    }
  });
  pendingSessionInitialization = initialization;
  return initialization;
}

export async function refreshSupabaseSession(): Promise<BeeGameSupabaseSession | null> {
  if (pendingSessionRefresh) return pendingSessionRefresh;
  const refresh = refreshSupabaseSessionOnce().finally(() => {
    if (pendingSessionRefresh === refresh) pendingSessionRefresh = null;
  });
  pendingSessionRefresh = refresh;
  return refresh;
}

async function refreshSupabaseSessionOnce(): Promise<BeeGameSupabaseSession | null> {
  if (isHttpOnlySessionsEnabled()) {
    const response = await fetch(buildSameOriginApiUrl('/api/auth/session/refresh'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) {
      httpOnlySessionUser = null;
      return null;
    }
    const value = await response.json() as unknown;
    const session = toCookieSession(value);
    httpOnlySessionUser = session.user;
    return session;
  }
  const session = getStoredSupabaseSession();
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!session?.refreshToken || !supabaseUrl || !anonKey) return null;
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      refresh_token: session.refreshToken,
    }),
  });
  if (!response.ok) {
    clearSupabaseSession();
    return null;
  }
  const refreshed = toSupabaseSession(await response.json());
  saveSupabaseSession({
    ...refreshed,
    user: {
      ...session.user,
      ...refreshed.user,
    },
  });
  return getStoredSupabaseSession();
}

export function clearSupabaseSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
  httpOnlySessionUser = null;
  if (isHttpOnlySessionsEnabled()) {
    void fetch(buildSameOriginApiUrl('/api/auth/session/logout'), {
      method: 'POST',
      credentials: 'include',
    });
  }
}

function saveSupabaseSession(session: BeeGameSupabaseSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

async function persistSupabaseSession(session: BeeGameSupabaseSession): Promise<void> {
  if (!isHttpOnlySessionsEnabled()) {
    saveSupabaseSession(session);
    return;
  }
  const response = await fetch(buildSameOriginApiUrl('/api/auth/session'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      expires_in: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)),
    }),
  });
  if (response.ok) {
    try {
      const verificationResponse = await fetch(buildSameOriginApiUrl('/api/auth/session'), {
        credentials: 'include',
      });
      if (verificationResponse.ok) {
        const value = await verificationResponse.json() as unknown;
        const cookieSession = toCookieSession(value);
        localStorage.removeItem(SESSION_STORAGE_KEY);
        httpOnlySessionUser = cookieSession.user;
        return;
      }
    } catch {
      // The secure session is authoritative. Do not silently activate a
      // browser-token fallback when cookie verification fails.
    }
  }
  throw new SupabaseAuthApiError('Secure BeeGame session could not be established.', {
    code: 'secure_session_unavailable',
    status: response.status,
  });
}

export function isHttpOnlySessionsEnabled(): boolean {
  return String(import.meta.env.VITE_BEEGAME_HTTPONLY_SESSIONS ?? '').trim() === '1';
}

function buildSameOriginApiUrl(path: string): string {
  const base = String(import.meta.env.VITE_API_BASE_URL ?? '').trim();
  if (base) return `${trimTrailingSlash(base)}${path}`;
  return path;
}

async function exchangeSupabaseOAuthCode(authCode: string): Promise<BeeGameSupabaseSession> {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const pkce = readStoredPkceContext();
  if (!pkce?.codeVerifier) {
    throw new Error('OAuth session expired. Please try signing in again.');
  }
  const response = await fetch(`${trimTrailingSlash(supabaseUrl)}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      auth_code: authCode,
      code_verifier: pkce.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(toUserFacingOAuthError(await readSupabaseError(response), pkce.provider));
  }
  const session = toSupabaseSession(await response.json());
  await persistSupabaseSession(session);
  sessionStorage.removeItem(OAUTH_PKCE_STORAGE_KEY);
  return session;
}

function readStoredPkceContext(): {
  provider?: SupabaseOAuthProvider
  codeVerifier?: string
  invitationNonce?: string
} | undefined {
  const raw = sessionStorage.getItem(OAUTH_PKCE_STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) return undefined;
    const codeVerifier = typeof value.codeVerifier === 'string'
      ? value.codeVerifier.trim()
      : '';
    const createdAt = typeof value.createdAt === 'number' ? value.createdAt : 0;
    if (!codeVerifier || Date.now() - createdAt > 10 * 60 * 1000) return undefined;
    const provider = isSupabaseOAuthProvider(value.provider)
      ? value.provider
      : undefined;
    const invitationNonce = typeof value.invitationNonce === 'string'
      ? value.invitationNonce.trim()
      : '';
    return {
      provider,
      codeVerifier,
      ...(invitationNonce ? { invitationNonce } : {}),
    };
  } catch {
    return undefined;
  }
}

function getStoredSupabaseSession(): BeeGameSupabaseSession | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;
    const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken.trim() : '';
    const expiresAt = typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0;
    const user = isRecord(parsed.user) ? parsed.user : {};
    const id = typeof user.id === 'string' ? user.id.trim() : '';
    if (!accessToken || !expiresAt || !id) return null;
    return {
      accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : undefined,
      expiresAt,
      user: {
        id,
        email: typeof user.email === 'string' ? user.email : undefined,
        displayName: typeof user.displayName === 'string' ? user.displayName : undefined,
        avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
      },
    };
  } catch {
    return null;
  }
}

function toCookieSession(value: unknown): BeeGameSupabaseSession {
  if (!isRecord(value) || value.authenticated !== true) {
    throw new Error('Invalid server session response.');
  }
  const user = isRecord(value.user) ? value.user : {};
  const id = typeof user.id === 'string' ? user.id.trim() : '';
  if (!id) throw new Error('Invalid server session response.');
  return {
    accessToken: typeof value.access_token === 'string' ? value.access_token : '',
    expiresAt: typeof value.expires_at === 'number' ? value.expires_at : Date.now() + 3600_000,
    user: {
      id,
      email: typeof user.email === 'string' ? user.email : undefined,
      displayName: typeof user.displayName === 'string' ? user.displayName : undefined,
      avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : undefined,
    },
  };
}

function toSupabaseSession(value: unknown): BeeGameSupabaseSession {
  if (!isRecord(value)) throw new Error('Invalid Supabase Auth response.');
  const accessToken = typeof value.access_token === 'string' ? value.access_token.trim() : '';
  const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : undefined;
  const expiresIn = typeof value.expires_in === 'number' ? value.expires_in : 3600;
  const user = isRecord(value.user) ? value.user : {};
  const id = typeof user.id === 'string' ? user.id.trim() : '';
  if (!accessToken || !id) throw new Error('Invalid Supabase Auth response.');
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + Math.max(0, expiresIn - 30) * 1000,
    user: {
      id,
      email: readUserEmail(user),
      displayName: readUserDisplayName(user),
      avatarUrl: readUserAvatarUrl(user),
    },
  };
}

function readUserEmail(user: Record<string, unknown>): string | undefined {
  return readUserRootString(user, 'email') ??
    readUserMetadataString(user, 'email');
}

function readUserDisplayName(user: Record<string, unknown>): string | undefined {
  return readUserMetadataString(user, 'display_name') ??
    readUserMetadataString(user, 'full_name') ??
    readUserMetadataString(user, 'name') ??
    readUserMetadataString(user, 'username') ??
    readUserMetadataString(user, 'user_name') ??
    readUserMetadataString(user, 'preferred_username') ??
    readUserMetadataString(user, 'nickname') ??
    readUserMetadataString(user, 'screen_name') ??
    readUserMetadataString(user, 'global_name');
}

function readUserAvatarUrl(user: Record<string, unknown>): string | undefined {
  return readUserMetadataString(user, 'avatar_url') ??
    readUserMetadataString(user, 'picture') ??
    readUserMetadataString(user, 'image') ??
    readUserMetadataString(user, 'photo_url');
}

function readUserMetadataString(
  user: Record<string, unknown>,
  key: string,
): string | undefined {
  for (const metadata of getSupabaseMetadataRecords(user)) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readUserRootString(
  user: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = user[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getSupabaseMetadataRecords(
  user: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  if (isRecord(user.data)) records.push(user.data);
  if (isRecord(user.metadata)) records.push(user.metadata);
  if (isRecord(user.user_metadata)) records.push(user.user_metadata);
  if (isRecord(user.raw_user_meta_data)) records.push(user.raw_user_meta_data);
  if (Array.isArray(user.identities)) {
    for (const identity of user.identities) {
      if (!isRecord(identity)) continue;
      if (isRecord(identity.identity_data)) records.push(identity.identity_data);
    }
  }
  return records;
}

async function readSupabaseAuthError(response: Response): Promise<SupabaseAuthApiError> {
  const details = await readSupabaseErrorDetails(response);
  return new SupabaseAuthApiError(details.message, {
    code: details.code,
    status: details.status,
  });
}

async function readSupabaseError(response: Response): Promise<string> {
  return (await readSupabaseErrorDetails(response)).message;
}

async function readSupabaseErrorDetails(response: Response): Promise<{
  code: string;
  message: string;
  status: number;
}> {
  try {
    const value = await response.json() as unknown;
    if (isRecord(value)) {
      const code = typeof value.code === 'string'
        ? value.code
        : typeof value.error_code === 'string'
          ? value.error_code
          : '';
      const message = typeof value.msg === 'string'
        ? value.msg
        : typeof value.message === 'string'
          ? value.message
          : typeof value.error_description === 'string'
            ? value.error_description
            : typeof value.error === 'string'
              ? value.error
              : '';
      if (message.trim()) {
        return {
          code: code.trim(),
          message: message.trim(),
          status: response.status,
        };
      }
    }
  } catch {
    // Fall through to generic text/status handling.
  }
  const text = await response.text().catch(() => '');
  return {
    code: '',
    message: text.trim() || `Supabase Auth failed (${response.status})`,
    status: response.status,
  };
}

function readOAuthError(params: URLSearchParams): string | undefined {
  const error = params.get('error')?.trim() || '';
  const description = params.get('error_description')?.trim() ||
    params.get('error_code')?.trim() ||
    params.get('error_message')?.trim() ||
    '';
  if (!error && !description) return undefined;
  return decodeOAuthErrorText(description || `OAuth sign-in failed: ${error}`);
}

function toUserFacingOAuthError(
  message: string,
  provider?: SupabaseOAuthProvider,
): string {
  const decoded = decodeOAuthErrorText(message);
  if (decoded.toLowerCase().includes('unable to exchange external code')) {
    const label = provider ? getOAuthProviderLabel(provider) : 'Third-party';
    return `${label} sign-in reached BeeGame, but Supabase could not exchange the provider code. Check the provider client ID/secret and callback URL in Supabase Auth, then try again.`;
  }
  return decoded;
}

function decodeOAuthErrorText(value: string): string {
  let decoded = value.trim();
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded.replace(/\+/g, ' ')).trim();
      if (!next || next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function getOAuthProviderLabel(provider: SupabaseOAuthProvider): string {
  if (provider === 'github') return 'GitHub';
  if (provider === 'google') return 'Google';
  if (provider === 'facebook') return 'Facebook';
  if (provider === 'x') return 'X';
  if (provider === 'discord') return 'Discord';
  return 'Third-party';
}

function isSupabaseOAuthProvider(value: unknown): value is SupabaseOAuthProvider {
  return value === 'github' ||
    value === 'google' ||
    value === 'facebook' ||
    value === 'x' ||
    value === 'discord';
}

function getOAuthCallbackKey(): string {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(hash);
  const searchParams = new URLSearchParams(window.location.search);
  const hasCallback = Boolean(
    hashParams.get('access_token') ||
    hashParams.get('error') ||
    hashParams.get('error_description') ||
    searchParams.get('code') ||
    searchParams.get('error') ||
    searchParams.get('error_description'),
  );
  if (!hasCallback) return '';
  return `${window.location.pathname}?${window.location.search}#${window.location.hash}`;
}

function clearOAuthCallbackUrl(): void {
  window.history.replaceState({}, document.title, window.location.pathname);
}

function createPkceCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function createPkceCodeChallenge(codeVerifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await window.crypto.subtle.digest('SHA-256', bytes);
  return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) {
    value += String.fromCharCode(byte);
  }
  return btoa(value)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function validateOAuthRedirectUrl(value: string): string {
  try {
    const url = new URL(value);
    const currentOrigin = typeof window === 'undefined' ? '' : window.location.origin;
    if (url.protocol !== 'https:' && url.origin !== currentOrigin) {
      throw new Error('OAuth invitation start returned an unsafe redirect URL.');
    }
    return url.toString();
  } catch (error) {
    if (error instanceof Error && error.message.includes('unsafe redirect')) throw error;
    throw new Error('OAuth invitation start returned an invalid redirect URL.');
  }
}

function slugifyFileName(value: string): string {
  const [rawName = 'avatar', ...extensionParts] = value.split('.');
  const extension = extensionParts.pop()?.trim().toLowerCase();
  const name = rawName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'avatar';
  return extension
    ? `${name}.${extension.replace(/[^a-z0-9]/g, '') || 'png'}`
    : `${name}.png`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
