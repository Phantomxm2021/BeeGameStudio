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

export type SupabasePasswordSignInInput = {
  email: string;
  password: string;
};

export type SupabasePasswordSignUpInput = SupabasePasswordSignInInput & {
  displayName: string;
};

export type SupabaseOAuthProvider = 'github' | 'google';

const SESSION_STORAGE_KEY = 'beegame_supabase_session';

const getSupabaseUrl = (): string => String(import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const getSupabaseAnonKey = (): string => String(import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export function isSupabaseAuthConfigured(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

export function getSupabaseAccessToken(): string {
  const session = getStoredSupabaseSession();
  if (!session) return '';
  if (session.expiresAt <= Date.now()) {
    clearSupabaseSession();
    return '';
  }
  return session.accessToken;
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
    throw new Error(await readSupabaseError(response));
  }
  const session = toSupabaseSession(await response.json());
  saveSupabaseSession(session);
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
      },
    }),
  });
  if (!response.ok) {
    throw new Error(await readSupabaseError(response));
  }
  const value = await response.json();
  if (!isRecord(value) || typeof value.access_token !== 'string') return null;
  const session = toSupabaseSession(value);
  saveSupabaseSession(session);
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
    throw new Error(await readSupabaseError(response));
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

export function signInWithSupabaseOAuth(provider: SupabaseOAuthProvider): void {
  const supabaseUrl = getSupabaseUrl();
  const anonKey = getSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase Auth is not configured.');
  }
  const url = new URL(`${trimTrailingSlash(supabaseUrl)}/auth/v1/authorize`);
  url.searchParams.set('provider', provider);
  url.searchParams.set('redirect_to', window.location.origin);
  window.location.assign(url.toString());
}

export function consumeSupabaseRedirectSession(): boolean {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return false;
  const params = new URLSearchParams(hash);
  const accessToken = params.get('access_token')?.trim() || '';
  if (!accessToken) return false;
  const expiresIn = Number.parseInt(params.get('expires_in') || '3600', 10);
  saveSupabaseSession({
    accessToken,
    refreshToken: params.get('refresh_token') || undefined,
    expiresAt: Date.now() + Math.max(0, (Number.isFinite(expiresIn) ? expiresIn : 3600) - 30) * 1000,
    user: { id: 'oauth' },
  });
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
  return true;
}

export async function hydrateSupabaseSessionUser(): Promise<BeeGameSupabaseSession | null> {
  const session = getStoredSupabaseSession();
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
  saveSupabaseSession(hydrated);
  return hydrated;
}

export function clearSupabaseSession(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function saveSupabaseSession(session: BeeGameSupabaseSession): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
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
    readUserMetadataString(user, 'user_name') ??
    readUserMetadataString(user, 'preferred_username') ??
    readUserMetadataString(user, 'nickname');
}

function readUserAvatarUrl(user: Record<string, unknown>): string | undefined {
  return readUserMetadataString(user, 'avatar_url') ??
    readUserMetadataString(user, 'picture') ??
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

async function readSupabaseError(response: Response): Promise<string> {
  try {
    const value = await response.json() as unknown;
    if (isRecord(value)) {
      const message = typeof value.msg === 'string'
        ? value.msg
        : typeof value.message === 'string'
          ? value.message
          : typeof value.error_description === 'string'
            ? value.error_description
            : '';
      if (message.trim()) return message.trim();
    }
  } catch {
    // Fall through to generic text/status handling.
  }
  const text = await response.text().catch(() => '');
  return text.trim() || `Supabase Auth failed (${response.status})`;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
