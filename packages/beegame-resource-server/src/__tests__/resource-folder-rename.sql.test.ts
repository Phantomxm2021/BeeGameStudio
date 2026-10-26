import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

// Keep the PostgreSQL engine optional and isolated from production dependencies.
const modulePath = process.env.BGS_PGLITE_MODULE
const sqlTest = modulePath ? test : test.skip
const migrationUrl = new URL(
  '../../../../supabase/migrations/20261025010000_resource_folder_rename_transaction.sql',
  import.meta.url,
)

async function createFixture(
  PGlite: new () => {
    exec(sql: string): Promise<unknown>
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>
    close(): Promise<void>
  },
) {
  const db = new PGlite()
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.beegame_resource_folders (
      id text primary key,
      pack_id text not null,
      name text not null,
      parent_id text,
      path text not null,
      updated_at timestamptz not null default now(),
      unique (pack_id, path)
    );
    create table public.beegame_resource_elements (
      id text primary key,
      pack_id text not null,
      path text not null,
      storage_object_id text not null,
      updated_at timestamptz not null default now(),
      unique (pack_id, path)
    );
    create table public.beegame_storage_objects (
      id text primary key,
      pack_id text not null,
      scope_type text not null,
      provider text not null,
      object_kind text not null,
      status text not null default 'ready',
      logical_path text,
      deleted_at timestamptz,
      updated_at timestamptz not null default now()
    );
  `)
  await db.exec(await readFile(migrationUrl, 'utf8'))
  await db.exec(`
    insert into public.beegame_resource_folders (id, pack_id, name, parent_id, path) values
      ('folder-root', 'pack-1', 'models', null, 'models'),
      ('folder-child', 'pack-1', 'characters', 'folder-root', 'models/characters'),
      ('folder-other', 'pack-1', 'audio', null, 'audio');
    insert into public.beegame_resource_elements (id, pack_id, path, storage_object_id) values
      ('element-root', 'pack-1', 'models/tree.glb', 'object-root'),
      ('element-child', 'pack-1', 'models/characters/hero.glb', 'object-child');
    insert into public.beegame_storage_objects (id, pack_id, scope_type, provider, object_kind, logical_path) values
      ('object-root', 'pack-1', 'pack', 'r2', 'resource_element', 'models/tree.glb'),
      ('object-child', 'pack-1', 'pack', 'r2', 'resource_element', 'models/characters/hero.glb');
  `)
  return db
}

sqlTest(
  'renames folders, descendants, elements, and R2 logical paths in one transaction',
  async () => {
    const { PGlite } = await import(modulePath!)
    const db = await createFixture(PGlite)
    try {
      const result = await db.query(
        `select public.beegame_rename_resource_folder($1, $2, $3) as folder`,
        ['pack-1', 'folder-root', 'assets'],
      )
      expect(
        (result.rows as Array<{ folder: Record<string, unknown> }>)[0]?.folder,
      ).toEqual({
        id: 'folder-root',
        pack_id: 'pack-1',
        name: 'assets',
        parent_id: null,
        path: 'assets',
      })
      expect(
        await db.query(
          `select id, path from public.beegame_resource_folders where pack_id = 'pack-1' order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'folder-child', path: 'assets/characters' },
          { id: 'folder-other', path: 'audio' },
          { id: 'folder-root', path: 'assets' },
        ],
      })
      expect(
        await db.query(
          `select id, path from public.beegame_resource_elements order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'element-child', path: 'assets/characters/hero.glb' },
          { id: 'element-root', path: 'assets/tree.glb' },
        ],
      })
      expect(
        await db.query(
          `select id, logical_path from public.beegame_storage_objects order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'object-child', logical_path: 'assets/characters/hero.glb' },
          { id: 'object-root', logical_path: 'assets/tree.glb' },
        ],
      })
    } finally {
      await db.close()
    }
  },
  30_000,
)

sqlTest(
  'rolls back all paths when a dependent element path conflicts',
  async () => {
    const { PGlite } = await import(modulePath!)
    const db = await createFixture(PGlite)
    try {
      await db.exec(`
      insert into public.beegame_resource_elements (id, pack_id, path, storage_object_id)
        values ('element-conflict', 'pack-1', 'assets/tree.glb', 'object-conflict');
      insert into public.beegame_storage_objects (id, pack_id, scope_type, provider, object_kind, logical_path)
        values ('object-conflict', 'pack-1', 'pack', 'r2', 'resource_element', 'assets/tree.glb');
    `)

      await expect(
        db.query(`select public.beegame_rename_resource_folder($1, $2, $3)`, [
          'pack-1',
          'folder-root',
          'assets',
        ]),
      ).rejects.toThrow()
      expect(
        await db.query(
          `select id, path from public.beegame_resource_folders where id in ('folder-root', 'folder-child') order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'folder-child', path: 'models/characters' },
          { id: 'folder-root', path: 'models' },
        ],
      })
      expect(
        await db.query(
          `select id, path from public.beegame_resource_elements where id in ('element-root', 'element-child') order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'element-child', path: 'models/characters/hero.glb' },
          { id: 'element-root', path: 'models/tree.glb' },
        ],
      })
      expect(
        await db.query(
          `select id, logical_path from public.beegame_storage_objects where id in ('object-root', 'object-child') order by id`,
        ),
      ).toMatchObject({
        rows: [
          { id: 'object-child', logical_path: 'models/characters/hero.glb' },
          { id: 'object-root', logical_path: 'models/tree.glb' },
        ],
      })
    } finally {
      await db.close()
    }
  },
  30_000,
)

sqlTest(
  'fails closed for missing or cross-Pack storage references',
  async () => {
    const { PGlite } = await import(modulePath!)
    const db = await createFixture(PGlite)
    try {
      await db.exec(`
      insert into public.beegame_resource_elements (id, pack_id, path, storage_object_id)
        values ('element-missing', 'pack-1', 'models/missing.glb', 'object-missing');
    `)

      await expect(
        db.query(`select public.beegame_rename_resource_folder($1, $2, $3)`, [
          'pack-1',
          'folder-root',
          'assets',
        ]),
      ).rejects.toThrow('Ready R2 Resource object not found')
      expect(
        await db.query(
          `select path from public.beegame_resource_folders where id = 'folder-root'`,
        ),
      ).toMatchObject({ rows: [{ path: 'models' }] })
      expect(
        await db.query(
          `select path from public.beegame_resource_elements where id = 'element-root'`,
        ),
      ).toMatchObject({ rows: [{ path: 'models/tree.glb' }] })
      expect(
        await db.query(
          `select logical_path from public.beegame_storage_objects where id = 'object-root'`,
        ),
      ).toMatchObject({ rows: [{ logical_path: 'models/tree.glb' }] })

      await db.exec(`
        delete from public.beegame_resource_elements where id = 'element-missing';
        insert into public.beegame_resource_elements (id, pack_id, path, storage_object_id)
          values ('element-cross-pack', 'pack-1', 'models/cross-pack.glb', 'object-cross-pack');
        insert into public.beegame_storage_objects (id, pack_id, scope_type, provider, object_kind, logical_path)
          values ('object-cross-pack', 'pack-2', 'pack', 'r2', 'resource_element', 'models/cross-pack.glb');
      `)

      await expect(
        db.query(`select public.beegame_rename_resource_folder($1, $2, $3)`, [
          'pack-1',
          'folder-root',
          'assets',
        ]),
      ).rejects.toThrow('Ready R2 Resource object not found')
      expect(
        await db.query(
          `select path from public.beegame_resource_folders where id = 'folder-root'`,
        ),
      ).toMatchObject({ rows: [{ path: 'models' }] })
      expect(
        await db.query(
          `select path from public.beegame_resource_elements where id = 'element-cross-pack'`,
        ),
      ).toMatchObject({ rows: [{ path: 'models/cross-pack.glb' }] })
    } finally {
      await db.close()
    }
  },
  30_000,
)

sqlTest(
  'keeps folder rename service-only and returns null for a wrong-Pack folder id',
  async () => {
    const { PGlite } = await import(modulePath!)
    const db = await createFixture(PGlite)
    try {
      const privileges = await db.query(`
        select
          has_function_privilege('service_role', 'public.beegame_rename_resource_folder(text,text,text)', 'EXECUTE') as service_can_execute,
          has_function_privilege('anon', 'public.beegame_rename_resource_folder(text,text,text)', 'EXECUTE') as anon_can_execute,
          has_function_privilege('authenticated', 'public.beegame_rename_resource_folder(text,text,text)', 'EXECUTE') as authenticated_can_execute
      `)
      expect(privileges.rows).toEqual([
        {
          service_can_execute: true,
          anon_can_execute: false,
          authenticated_can_execute: false,
        },
      ])

      const result = await db.query(
        `select public.beegame_rename_resource_folder($1, $2, $3) as folder`,
        ['pack-other', 'folder-root', 'assets'],
      )
      expect((result.rows as Array<{ folder: unknown }>)[0]?.folder).toBeNull()
      expect(
        await db.query(
          `select path from public.beegame_resource_folders where id = 'folder-root'`,
        ),
      ).toMatchObject({ rows: [{ path: 'models' }] })
    } finally {
      await db.close()
    }
  },
  30_000,
)
