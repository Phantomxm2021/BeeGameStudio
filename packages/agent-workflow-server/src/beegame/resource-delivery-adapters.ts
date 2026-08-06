import createAssimp from 'assimpjs'
import type { ResourceDeliveryCapability } from '@bee-game-studio/beegame-resource-core'

const ASSIMP_FBX_GLB_ADAPTER = 'assimp-fbx-glb2'

export function configuredResourceDeliveryCapabilities(
  targetFormats: readonly string[],
): ResourceDeliveryCapability[] {
  const normalizedTargets = [...new Set(targetFormats.map(normalizeFormat).filter(Boolean))]
  return [
    ...normalizedTargets.map(format => ({
      sourceFormat: format,
      disposition: 'direct' as const,
      targetFormat: format,
      adapterId: `direct-${format}`,
    })),
    ...(normalizedTargets.includes('glb')
      ? [{
          sourceFormat: 'fbx',
          disposition: 'convert' as const,
          targetFormat: 'glb',
          adapterId: ASSIMP_FBX_GLB_ADAPTER,
        }]
      : []),
  ]
}

export async function convertResourceDelivery(
  files: Array<{ name: string; bytes: Uint8Array }>,
  delivery: {
    disposition: 'direct' | 'convert'
    source_format: string
    target_format: string
    adapter_id?: string
  },
): Promise<{ filename: string; bytes: Uint8Array }> {
  if (
    delivery.disposition !== 'convert' ||
    delivery.adapter_id !== ASSIMP_FBX_GLB_ADAPTER ||
    normalizeFormat(delivery.source_format) !== 'fbx' ||
    normalizeFormat(delivery.target_format) !== 'glb'
  ) {
    throw new Error(`Unsupported resource delivery adapter: ${delivery.adapter_id ?? 'missing'}`)
  }
  const assimp = await createAssimp()
  const fileList = new assimp.FileList()
  for (const file of files) fileList.AddFile(file.name, file.bytes)
  const result = assimp.ConvertFileList(fileList, 'glb2')
  if (!result.IsSuccess() || result.FileCount() !== 1) {
    throw new Error(`Resource conversion failed: ${result.GetErrorCode()}`)
  }
  const output = result.GetFile(0)
  const bytes = new Uint8Array(output.GetContent())
  if (!bytes.byteLength) throw new Error('Resource conversion produced an empty GLB')
  const sourceName = files[0]?.name ?? 'resource.fbx'
  const separator = sourceName.lastIndexOf('.')
  const stem = separator > 0 ? sourceName.slice(0, separator) : sourceName
  return { filename: `${stem}.glb`, bytes }
}

function normalizeFormat(value: string): string {
  const normalized = value.trim().toLocaleLowerCase()
  return normalized.startsWith('.') ? normalized.slice(1) : normalized
}
