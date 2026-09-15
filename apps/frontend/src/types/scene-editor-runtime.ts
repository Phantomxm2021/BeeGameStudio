import type { ComponentType } from 'react';
import type { SceneDocument } from '../../../../packages/scene-editor/src/model';

export type {
  SceneDocument,
  SceneNode,
  Transform,
} from '../../../../packages/scene-editor/src/model';

export interface SceneEditorProps {
  initialDocument?: SceneDocument;
  storageKey?: string;
  onSave?: (document: SceneDocument) => void | Promise<void>;
  onClose?: () => void;
}

export declare const SceneEditor: ComponentType<SceneEditorProps>;
