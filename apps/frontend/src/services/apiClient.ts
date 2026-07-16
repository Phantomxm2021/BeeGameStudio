import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  getSupabaseAccessToken,
  getValidSupabaseAccessToken,
  isHttpOnlySessionsEnabled,
  refreshSupabaseSession,
} from './supabaseAuthApi';

export interface ApiErrorEnvelope {
  code: string;
  message: string;
  recoverable: boolean;
  trace_id: string;
  task_id?: string;
  project_id?: string;
}

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
export const AUTHENTICATION_REQUIRED_EVENT = 'beegame:authentication-required';

let showToastError: ((message: string) => void) | null = null;

const getEnvAuthToken = (): string => {
  // VITE_* values are bundled into the browser. Never treat a deployment token
  // as a production secret or allow it to authorize production requests.
  if (import.meta.env.MODE === 'production') return '';
  return String(import.meta.env.VITE_API_AUTH_TOKEN ?? '').trim();
};

export const hasEnvAuthToken = (): boolean => Boolean(getEnvAuthToken());

export const resolveAuthToken = (): string => (
  getSupabaseAccessToken() || (isHttpOnlySessionsEnabled() ? '' : getEnvAuthToken())
);

export const resolveAuthTokenAsync = async (): Promise<string> => (
  await getValidSupabaseAccessToken() || (isHttpOnlySessionsEnabled() ? '' : getEnvAuthToken())
);

export const buildApiUrl = (path: string): string => {
  return buildApiUrlWithBase(path, API_BASE_URL);
};

export const buildApiUrlWithBase = (path: string, baseUrl: string): string => {
  if (!baseUrl || /^[a-z][a-z\d+\-.]*:/i.test(path)) {
    return path;
  }
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

export const buildAuthHeaders = (headers?: HeadersInit): Headers => {
  const nextHeaders = new Headers(headers);
  const token = resolveAuthToken();
  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
};

export const authenticatedFetch = (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => (async () => {
  const nextInput = typeof input === 'string' ? buildApiUrl(input) : input;
  const response = await fetch(nextInput, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers: await buildAuthHeadersAsync(init.headers, isTrustedApiRequest(nextInput)),
  });
  if (response.status !== 401) return response;
  if (!isHttpOnlySessionsEnabled() && !getSupabaseAccessToken() && getEnvAuthToken()) {
    notifyAuthenticationRequired();
    return response;
  }
  const refreshed = await refreshSupabaseSession();
  if (!refreshed) {
    notifyAuthenticationRequired();
    return response;
  }
  const retriedResponse = await fetch(nextInput, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers: await buildAuthHeadersAsync(init.headers, isTrustedApiRequest(nextInput)),
  });
  return retriedResponse;
})();

export const buildUnauthorizedMessage = (backendMessage?: string): string => {
  const normalizedBackendMessage = String(backendMessage ?? '').trim();
  if (normalizedBackendMessage) {
    return normalizedBackendMessage;
  }
  if (!resolveAuthToken()) {
    return '请先登录 BeeGame';
  }
  return '未授权，token 无效或已失效';
};

export const setToastErrorCallback = (callback: (message: string) => void) => {
  showToastError = callback;
};

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
  withCredentials: true,
});

apiClient.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await resolveAuthTokenAsync();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError) => {
    let authenticationIsDefinitivelyInvalid = false;
    if (
      error.response?.status === 401 &&
      (isHttpOnlySessionsEnabled() || getSupabaseAccessToken() || !getEnvAuthToken()) &&
      error.config &&
      !isRetriedRequest(error.config)
    ) {
      const refreshed = await refreshSupabaseSession();
      if (refreshed) {
        markRetriedRequest(error.config);
        error.config.headers = error.config.headers ?? {};
        // Cookie sessions deliberately never expose the access token. Do not
        // synthesize an empty Authorization header: it would prevent the
        // server from injecting the valid token recovered from the cookie.
        if (refreshed.accessToken) {
          error.config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        }
        return apiClient.request(error.config);
      }
      authenticationIsDefinitivelyInvalid = true;
    } else if (
      error.response?.status === 401 &&
      (!error.config || !isRetriedRequest(error.config))
    ) {
      authenticationIsDefinitivelyInvalid = true;
    }
    if (authenticationIsDefinitivelyInvalid) notifyAuthenticationRequired();
    const hideToast = getHeaderValue(error.config?.headers, 'Hide-Error-Toast') === 'true';
    const hideErrorLog = getHeaderValue(error.config?.headers, 'Hide-Error-Log') === 'true';
    if (!hideErrorLog) {
      console.error('API Error:', error);
    }

    let errorMessage = '请求失败，请稍后重试';
    let errorCode: string | undefined;
    let errorHostname: string | undefined;
    if (error.response) {
      const { status, data } = error.response;
      const responseData = data as Partial<ApiErrorEnvelope> & {
        detail?: string;
        error?: string;
        hostname?: string;
      };
      errorCode = typeof responseData?.code === 'string' ? responseData.code : undefined;
      errorHostname = typeof responseData?.hostname === 'string' ? responseData.hostname : undefined;
      const backendMessage = responseData?.message || responseData?.detail || responseData?.error;
      switch (status) {
        case 400:
          errorMessage = backendMessage || '请求参数错误';
          break;
        case 401:
          errorMessage = buildUnauthorizedMessage(backendMessage);
          break;
        case 403:
          errorMessage = '没有权限访问该资源';
          break;
        case 404:
          errorMessage = '请求的资源不存在';
          break;
        case 500:
          errorMessage = '服务器内部错误';
          break;
        case 503:
          errorMessage = backendMessage || '服务暂时不可用';
          break;
        default:
          errorMessage = backendMessage || `请求失败 (${status})`;
      }
    } else if (error.request) {
      errorMessage = '网络连接失败，请检查网络设置';
    } else {
      errorMessage = error.message || '请求配置错误';
    }

    if (showToastError && !hideToast) {
      showToastError(errorMessage);
    }

    const enhancedError = new Error(errorMessage) as Error & {
      originalError?: AxiosError;
      status?: number;
      code?: string;
      hostname?: string;
    };
    enhancedError.originalError = error;
    enhancedError.status = error.response?.status;
    enhancedError.code = errorCode;
    enhancedError.hostname = errorHostname;
    return Promise.reject(enhancedError);
  },
);

const BEEGAME_AUTH_RETRY_HEADER = 'X-BeeGame-Auth-Retry';

const notifyAuthenticationRequired = (): void => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTHENTICATION_REQUIRED_EVENT));
  }
};

const buildAuthHeadersAsync = async (headers?: HeadersInit, attachAuth = true): Promise<Headers> => {
  const nextHeaders = new Headers(headers);
  if (!attachAuth) return nextHeaders;
  const token = await resolveAuthTokenAsync();
  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
};

const isTrustedApiRequest = (input: RequestInfo | URL): boolean => {
  const raw = typeof input === 'string' ? input : input.toString();
  try {
    const pageOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
    const requestUrl = new URL(raw, pageOrigin);
    if (!API_BASE_URL) return requestUrl.origin === pageOrigin;
    const apiUrl = new URL(API_BASE_URL, pageOrigin);
    return requestUrl.origin === apiUrl.origin;
  } catch {
    return false;
  }
};

const isRetriedRequest = (config: InternalAxiosRequestConfig): boolean => (
  String(config.headers?.[BEEGAME_AUTH_RETRY_HEADER] ?? '') === '1'
);

const markRetriedRequest = (config: InternalAxiosRequestConfig): void => {
  config.headers = config.headers ?? {};
  config.headers[BEEGAME_AUTH_RETRY_HEADER] = '1';
};

const getHeaderValue = (
  headers: InternalAxiosRequestConfig['headers'] | undefined,
  name: string,
): string => {
  const directValue = headers?.[name];
  if (directValue !== undefined) return String(directValue);
  const lowerName = name.toLowerCase();
  const lowerValue = headers?.[lowerName];
  if (lowerValue !== undefined) return String(lowerValue);
  const get = (headers as { get?: (headerName: string) => unknown } | undefined)?.get;
  if (typeof get === 'function') {
    const value = get.call(headers, name);
    return value === undefined || value === null ? '' : String(value);
  }
  return '';
};

export default apiClient;
