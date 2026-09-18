import type { ComponentType } from 'react';
import type { SceneDocument } from '../../../../packages/scene-editor/src/model';

export type {
  SceneDocument,
  SceneAsset,
  SceneNode,
  SceneComponent,
  MaterialOverride,
  Transform,
} from '../../../../packages/scene-editor/src/model';

export interface SceneEditorProps {
  initialDocument?: SceneDocument;
  initialView?: { position: [number, number, number]; target: [number, number, number]; showGizmos?: boolean };
  initialProjection?: 'perspective' | 'orthographic';
  storageKey?: string;
  onSave?: (document: SceneDocument) => void | Promise<void>;
  onClose?: () => void;
}


export declare const SceneEditor: ComponentType<SceneEditorProps>;
