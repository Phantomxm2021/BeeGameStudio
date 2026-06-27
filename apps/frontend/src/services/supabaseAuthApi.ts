export type BeeGameSupabaseUser = {
  id: string;
  email?: string;
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
      email: typeof user.email === 'string' ? user.email : undefined,
    },
  };
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
