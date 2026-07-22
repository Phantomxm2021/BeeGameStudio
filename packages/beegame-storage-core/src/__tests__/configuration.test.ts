import { describe, expect, test } from 'bun:test'
import { resolveProjectStorageConfiguration } from '../configuration'

describe('project storage configuration', () => {
  test('keeps the current provider unless R2 is explicitly selected', () => {
    expect(resolveProjectStorageConfiguration({})).toEqual({
      provider: 'supabase',
    })
  })

  test('uses stable platform bucket names when no overrides are supplied', () => {
    expect(
      resolveProjectStorageConfiguration({
        BEEGAME_PROJECT_STORAGE_PROVIDER: 'r2',
        BEEGAME_R2_ACCOUNT_ID: 'account',
        BEEGAME_R2_ACCESS_KEY_ID: 'access',
        BEEGAME_R2_SECRET_ACCESS_KEY: 'secret',
      }),
    ).toMatchObject({
      buckets: {
        'project-private': 'beegame-project-private',
        'resource-private': 'beegame-resource-private',
        delivery: 'beegame-delivery',
        'log-private': 'beegame-log-private',
      },
    })
  })

  test('derives isolated bucket names from an environment prefix', () => {
    expect(
      resolveProjectStorageConfiguration({
        BEEGAME_PROJECT_STORAGE_PROVIDER: 'r2',
        BEEGAME_R2_ACCOUNT_ID: 'account',
        BEEGAME_R2_ACCESS_KEY_ID: 'access',
        BEEGAME_R2_SECRET_ACCESS_KEY: 'secret',
        BEEGAME_R2_BUCKET_PREFIX: 'beegame-staging',
      }),
    ).toMatchObject({
      buckets: {
        'project-private': 'beegame-staging-project-private',
        'resource-private': 'beegame-staging-resource-private',
        delivery: 'beegame-staging-delivery',
        'log-private': 'beegame-staging-log-private',
      },
    })
  })

  test('resolves all physical bucket roles without hardcoded names', () => {
    const config = resolveProjectStorageConfiguration({
      BEEGAME_PROJECT_STORAGE_PROVIDER: 'r2',
      BEEGAME_R2_ACCOUNT_ID: 'account',
      BEEGAME_R2_ACCESS_KEY_ID: 'access',
      BEEGAME_R2_SECRET_ACCESS_KEY: 'secret',
      BEEGAME_R2_PROJECT_BUCKET: 'project-data',
      BEEGAME_R2_RESOURCE_BUCKET: 'resource-data',
      BEEGAME_R2_DELIVERY_BUCKET: 'delivery-data',
      BEEGAME_R2_LOG_BUCKET: 'log-data',
    })
    expect(config).toEqual({
      provider: 'r2',
      r2: {
        accountId: 'account',
        accessKeyId: 'access',
        secretAccessKey: 'secret',
      },
      buckets: {
        'project-private': 'project-data',
        'resource-private': 'resource-data',
        delivery: 'delivery-data',
        'log-private': 'log-data',
      },
    })
  })
})
