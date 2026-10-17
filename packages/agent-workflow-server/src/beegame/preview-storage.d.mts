export const PREVIEW_STORAGE_PATH: '/__bgs/preview-storage'
export const PREVIEW_STORAGE_HEADER: 'X-BeeGame-Preview-Storage'
export const PREVIEW_STORAGE_VERSION: 'project-v1'
export const PREVIEW_STORAGE_MAX_VALUE: number
export class PreviewStorageError extends Error { status: number; constructor(message: string, status?: number) }
export function validatePreviewStorageItem(key: unknown, value: unknown): void
export function setPreviewStorageItem(entries: Map<string, string>, key: string, value: string | null): void
export type PreviewStorageItems = { getItem(key: string): string | null; setItem(key: string, value: string | null): void }
export function handlePreviewStorageRequest(request: Request, store: PreviewStorageItems, authorize?: () => Promise<unknown>): Promise<Response>
export function createGameStorage(documentUrl?: string | URL,
  fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Promise<{
    kind: 'preview' | 'deployment'; getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>; removeItem(key: string): Promise<void>
  }>
