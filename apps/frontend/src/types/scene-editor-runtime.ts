import type { ComponentType } from 'react';
import type { SceneDocument, SceneAsset } from '../../../../packages/scene-editor/src/model';
export { parseTileSet, parseGridData, parseTilemapData, parseTilemapRendererData, validateTilemapGrid } from '../../../../packages/scene-editor/src/tilemap-data';

export type {
  SceneDocument,
  SceneAsset,
  SpriteSheet,
  SceneNode,
  SceneComponent,
  MaterialOverride,
  Transform,
} from '../../../../packages/scene-editor/src/model';

export interface SceneEditorProps {
  onUploadAssets?: (files: File[]) => Promise<Record<string, SceneAsset>>;
  initialDocument?: SceneDocument;
  initialView?: { position: [number, number, number]; target: [number, number, number]; showGizmos?: boolean };
  initialProjection?: 'perspective' | 'orthographic';
  storageKey?: string;
  onSave?: (document: SceneDocument) => void | Promise<void>;
  onClose?: () => void;
  onDirtyChange?: (dirty: boolean, saving: boolean) => void;
  sceneChoices?: { id: string; label: string }[];
  selectedSceneId?: string;
  onSelectScene?: (id: string) => void;
  sceneSwitchDisabled?: boolean;
}


export declare const SceneEditor: ComponentType<SceneEditorProps>;

export { spriteSheetSelection, parseSpriteSheet, atlasFrameName } from '../../../../packages/scene-editor/src/sprite-sheet';
export { canvasReferenceSize, sceneLayerOrders, uiAnchor, uiLocalMatrix, uiPaintOrder } from '../../../../packages/scene-editor/src/content-coordinates';
export { resolveUiNodesForViewport } from '../../../../packages/scene-editor/src/ui-responsive';
export { initializeUiLayout } from '../../../../packages/scene-editor/src/ui-container-layout';
export { createUiTextMeasurer } from '../../../../packages/scene-editor/src/ui-text-measurement';
export * from '../../../../packages/scene-editor/src/scene-camera';
export * from '../../../../packages/scene-editor/src/scene-layout-inspection';
