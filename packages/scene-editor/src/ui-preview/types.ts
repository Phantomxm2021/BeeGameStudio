import type { UiLayoutOverride } from '../ui-responsive';

export type BeeGameUiContentNode = {
  id: string
  parentId?: string
  role: string
  enabled?: boolean
  name?: string
  text?: string
  assetRef?: string
  layout?: UiLayoutOverride
  responsive?: {
    compact?: { enabled?: boolean; layout?: BeeGameUiContentNode['layout']; style?: Record<string, unknown> }
    portrait?: { enabled?: boolean; layout?: BeeGameUiContentNode['layout']; style?: Record<string, unknown> }
  }
  bindings?: Record<string, string>
  actions?: Record<string, string>
  style?: Record<string, unknown>
  data?: Record<string, unknown>
}
