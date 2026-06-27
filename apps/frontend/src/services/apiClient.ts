import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

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

const getEnvAuthToken = (): string => String(import.meta.env.VITE_API_AUTH_TOKEN ?? '').trim();

export const resolveAuthToken = (): string => {
  const envToken = getEnvAuthToken();
  if (envToken) {
    return envToken;
  }
  return String(localStorage.getItem('auth_token') ?? '').trim();
};

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
): Promise<Response> => {
  const nextInput = typeof input === 'string' ? buildApiUrl(input) : input;
  return fetch(nextInput, {
    ...init,
    headers: buildAuthHeaders(init.headers),
  });
};

export const buildUnauthorizedMessage = (backendMessage?: string): string => {
  const normalizedBackendMessage = String(backendMessage ?? '').trim();
  if (normalizedBackendMessage) {
    return normalizedBackendMessage;
  }
  if (!resolveAuthToken()) {
    return '后端已开启鉴权，但前端未配置 token';
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
  (config: InternalAxiosRequestConfig) => {
    const token = resolveAuthToken();
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error),
);

apiClient.interceptors.response.use(
  (response) => response.data,
  (error: AxiosError) => {
    console.error('API Error:', error);

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
          if (!getEnvAuthToken()) {
            localStorage.removeItem('auth_token');
          }
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

    const hideToast = error.config?.headers?.['Hide-Error-Toast'] === 'true';
    if (showToastError && !hideToast) {
      showToastError(errorMessage);
    }

    const enhancedError = new Error(errorMessage) as Error & { originalError?: AxiosError; status?: number };
    enhancedError.originalError = error;
    enhancedError.status = error.response?.status;
    return Promise.reject(enhancedError);
  },
);

export default apiClient;
