import {
  resolveR2StorageDriverConfig,
  type R2StorageDriverConfig,
} from './r2-storage-driver'
import type { ProjectStorageBucketRole } from './types'

export type ProjectStorageConfiguration =
  | { provider: 'supabase' }
  | {
      provider: 'r2'
      r2: R2StorageDriverConfig
      buckets: Record<ProjectStorageBucketRole, string>
    }

const R2_BUCKET_ENV: Record<ProjectStorageBucketRole, string> = {
  'project-private': 'BEEGAME_R2_PROJECT_BUCKET',
  'resource-private': 'BEEGAME_R2_RESOURCE_BUCKET',
  delivery: 'BEEGAME_R2_DELIVERY_BUCKET',
  'log-private': 'BEEGAME_R2_LOG_BUCKET',
}

const R2_BUCKET_SUFFIX: Record<ProjectStorageBucketRole, string> = {
  'project-private': 'project-private',
  'resource-private': 'resource-private',
  delivery: 'delivery',
  'log-private': 'log-private',
}

export const DEFAULT_R2_BUCKET_PREFIX = 'beegame'

export function resolveR2BucketNames(
  env: Record<string, string | undefined>,
): Record<ProjectStorageBucketRole, string> {
  const prefix =
    env.BEEGAME_R2_BUCKET_PREFIX?.trim() || DEFAULT_R2_BUCKET_PREFIX
  assertBucketName(prefix, 'BEEGAME_R2_BUCKET_PREFIX')
  return Object.fromEntries(
    Object.entries(R2_BUCKET_ENV).map(([role, envName]) => {
      const value =
        env[envName]?.trim() ||
        `${prefix}-${R2_BUCKET_SUFFIX[role as ProjectStorageBucketRole]}`
      assertBucketName(value, envName)
      return [role, value]
    }),
  ) as Record<ProjectStorageBucketRole, string>
}

/**
 * Defaults to the existing Supabase path. Selecting R2 is fail-closed: every
 * required credential and bucket role must be configured before startup.
 */
export function resolveProjectStorageConfiguration(
  env: Record<string, string | undefined>,
): ProjectStorageConfiguration {
  const provider = env.BEEGAME_PROJECT_STORAGE_PROVIDER?.trim() || 'supabase'
  if (provider === 'supabase') return { provider }
  if (provider !== 'r2') {
    throw new Error(`Unsupported project storage provider: ${provider}`)
  }

  return {
    provider: 'r2',
    r2: resolveR2StorageDriverConfig(env),
    buckets: resolveR2BucketNames(env),
  }
}

function assertBucketName(value: string, source: string): void {
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
    throw new Error(
      `${source} must produce a lowercase R2 bucket name between 3 and 63 characters`,
    )
  }
}
