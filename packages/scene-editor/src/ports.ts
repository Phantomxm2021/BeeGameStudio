import type { SceneDocument } from './model'
export interface SceneEditorPorts { load?(): Promise<SceneDocument>; save?(document: SceneDocument): Promise<void>; notify?(message: string, level?: 'info' | 'warning' | 'error'): void }
