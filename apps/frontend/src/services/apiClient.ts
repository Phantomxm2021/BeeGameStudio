import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  getSupabaseAccessToken,
  getValidSupabaseAccessToken,
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

let showToastError: ((message: string) => void) | null = null;

const getEnvFlag = (value: unknown): boolean => value === true || value === '1' || value === 'true';

const isDevAuthTokenAllowed = (): boolean => (
  import.meta.env.MODE !== 'production' ||
  getEnvFlag(import.meta.env.VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN)
);

const getEnvAuthToken = (): string => {
  if (!isDevAuthTokenAllowed()) return '';
  return String(import.meta.env.VITE_API_AUTH_TOKEN ?? '').trim();
};

export const hasEnvAuthToken = (): boolean => Boolean(getEnvAuthToken());

export const resolveAuthToken = (): string => getSupabaseAccessToken() || getEnvAuthToken();

export const resolveAuthTokenAsync = async (): Promise<string> => (
  await getValidSupabaseAccessToken() || getEnvAuthToken()
);

export const buildApiUrl = (path: string): string => {
  if (!API_BASE_URL || /^[a-z][a-z\d+\-.]*:/i.test(path)) {
    return path;
  }
  const normalizedBase = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
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
    headers: await buildAuthHeadersAsync(init.headers),
  });
  if (response.status !== 401 || (!getSupabaseAccessToken() && getEnvAuthToken())) return response;
  const refreshed = await refreshSupabaseSession();
  if (!refreshed) return response;
  return fetch(nextInput, {
    ...init,
    headers: await buildAuthHeadersAsync(init.headers),
  });
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
    if (
      error.response?.status === 401 &&
      (getSupabaseAccessToken() || !getEnvAuthToken()) &&
      error.config &&
      !isRetriedRequest(error.config)
    ) {
      const refreshed = await refreshSupabaseSession();
      if (refreshed) {
        markRetriedRequest(error.config);
        error.config.headers = error.config.headers ?? {};
        error.config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return apiClient.request(error.config);
      }
    }
    const hideToast = getHeaderValue(error.config?.headers, 'Hide-Error-Toast') === 'true';
    const hideErrorLog = getHeaderValue(error.config?.headers, 'Hide-Error-Log') === 'true';
    if (!hideErrorLog) {
      console.error('API Error:', error);
    }

    let errorMessage = '请求失败，请稍后重试';
    if (error.response) {
      const { status, data } = error.response;
      const responseData = data as Partial<ApiErrorEnvelope> & { detail?: string };
      const backendMessage = responseData?.message || responseData?.detail;
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
          errorMessage = '服务暂时不可用';
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

    const enhancedError = new Error(errorMessage) as Error & { originalError?: AxiosError; status?: number };
    enhancedError.originalError = error;
    enhancedError.status = error.response?.status;
    return Promise.reject(enhancedError);
  },
);

const BEEGAME_AUTH_RETRY_HEADER = 'X-BeeGame-Auth-Retry';

const buildAuthHeadersAsync = async (headers?: HeadersInit): Promise<Headers> => {
  const nextHeaders = new Headers(headers);
  const token = await resolveAuthTokenAsync();
  if (token && !nextHeaders.has('Authorization')) {
    nextHeaders.set('Authorization', `Bearer ${token}`);
  }
  return nextHeaders;
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
