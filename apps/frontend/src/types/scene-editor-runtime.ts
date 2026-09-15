import type { ComponentType } from 'react';

export interface SceneEditorProps {
  storageKey?: string;
  onClose?: () => void;
}

export declare const SceneEditor: ComponentType<SceneEditorProps>;
