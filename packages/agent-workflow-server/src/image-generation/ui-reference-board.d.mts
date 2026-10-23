import type { ImageRequest } from './provider'

type BoardRequest = Pick<ImageRequest, 'quality' | 'background' | 'size'> & {
  requestId: string
  prompt?: string
  uiReference?: unknown
  referenceImagePath?: string
}

export function compileUiReferenceBoard(request: BoardRequest, screenOrientation?: 'Landscape' | 'Portrait'): {
  request: Omit<BoardRequest, 'uiReference' | 'prompt'> & { prompt: string }
  layout: {
    canvas: { width: number; height: number }
    viewport: { width: number; height: number }
    columns: number
    rows: number
    gap: number
    emptyCells: number
    panels: Array<{ id: string; row: number; column: number; x: number; y: number; width: number; height: number }>
  }
  note: string
}

type AssetSheetRequest = BoardRequest & { purpose?: string; requirementIds?: string[]; uiAssets?: unknown }
export function compileUiAssetSheet(request: AssetSheetRequest): {
  request: Omit<AssetSheetRequest, 'uiAssets' | 'uiReference' | 'prompt'> & { prompt: string }
  layout: ReturnType<typeof compileUiReferenceBoard>['layout'] & {
    elements: Array<{ id: string; description: string; width: number; height: number }>
  }
  note: string
}
