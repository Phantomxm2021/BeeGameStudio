import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, lstat, realpath, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, test, afterEach } from 'bun:test'
import { zipSync, strToU8 } from 'fflate'
import {
  getBuiltinSkillsDirectory,
  importUserSkill,
  listUserSkills,
  materializeUserSkills,
  parseSkillZipPackage,
} from '../store'
import {
  BeeGameSkillValidationError,
} from '../types'

let dataDir = ''

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  dataDir = ''
})

describe('BeeGame skills store', () => {
  test('loads the packaged BeeGameStudio built-in Skill catalog', async () => {
    const directory = getBuiltinSkillsDirectory()
    expect(directory).toBe(resolve(import.meta.dir, '../../../../.beegame/plugins/bgs-game-development'))
    expect(existsSync(resolve(directory, '../../skills/bgs-game-skills'))).toBe(false)
    const names = readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(join(directory, entry.name, 'SKILL.md')))
      .map(entry => entry.name).sort()
    expect(names).toEqual([
      'beegame-interaction-contracts',
      'bgs-3d-asset',
      'game-art-director-expert',
      'game-audio-designer',
      'game-balance-designer-expert',
      'game-content-pipeline-engineer',
      'game-creative-director-expert',
      'game-design-check',
      'game-feel-designer',
      'game-level-designer-expert',
      'game-playtest-performance',
      'game-systems-designer-expert',
      'game-technical-artist',
      'game-ui-ux-designer',
      'phaser4-gamedev',
      'spatial-computing-game-expert',
      'spatial-computing-ux-designer-expert',
      'threejs-gamedev',
    ])
    const manifest = JSON.parse(await readFile(join(directory, '.codex-plugin/plugin.json'), 'utf8'))
    expect(manifest.name).toBe('bgs-game-development')
    expect(manifest.skills).toEqual(names.map(name => './' + name))
    const marketplace = JSON.parse(await readFile(join(directory, '.agents/plugins/marketplace.json'), 'utf8'))
    expect(marketplace.plugins).toEqual([{name:'bgs-game-development',source:{source:'local',path:'./'},
      policy:{installation:'INSTALLED_BY_DEFAULT',authentication:'ON_USE'},category:'Developer Tools'}])
    expect(existsSync(join(directory, 'gameplay-programmer'))).toBe(false)
    expect(existsSync(join(directory, 'references/runtime-dependencies.md'))).toBe(true)
    expect(existsSync(join(directory, 'phaser4-gamedev/references/react-host-integration.md'))).toBe(true)
  })

  test('imports zip skill packages and materializes enabled skills', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: movement-contracts',
        'description: Keep movement controls consistent.',
        '---',
        '',
        '# Movement',
      ].join('\n'),
      'references/xr.md': '# XR movement',
    }))

    const skill = importUserSkill('user_1', { files }, { dataDir })

    expect(skill.slug).toBe('movement-contracts')
    expect(listUserSkills('user_1', { dataDir })).toHaveLength(1)
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'skill.json'),
      'utf8',
    )).resolves.toContain('"slug": "movement-contracts"')
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Movement')
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'files', 'SKILL.md'),
      'utf8',
    )).rejects.toThrow()

    materializeUserSkills([skill], { dataDir })
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'bgs', 'skills', 'user-movement-contracts', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Movement')
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'bgs', 'skills', 'user-movement-contracts', 'references', 'xr.md'),
      'utf8',
    )).resolves.toContain('XR movement')
  })

  test('keeps custom skills isolated by authenticated user', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-users-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: private-workflow',
        'description: User-owned workflow.',
        '---',
        '',
        '# Private Workflow',
      ].join('\n'),
    }))

    importUserSkill('user-a', { files }, { dataDir })

    expect(listUserSkills('user-a', { dataDir })).toHaveLength(1)
    expect(listUserSkills('user-b', { dataDir })).toEqual([])
  })

  test('rejects unsafe package paths', () => {
    expect(() => parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: unsafe-skill',
        'description: Unsafe.',
        '---',
      ].join('\n'),
      '../outside.md': 'bad',
    }))).toThrow(BeeGameSkillValidationError)
  })

  test('rejects duplicate user skill slugs', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-duplicate-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: movement-contracts',
        'description: Keep movement controls consistent.',
        '---',
      ].join('\n'),
    }))

    importUserSkill('user_1', { files }, { dataDir })

    expect(() => importUserSkill('user_1', { files }, { dataDir }))
      .toThrow('Skill already exists')
    expect(listUserSkills('user_1', { dataDir })).toHaveLength(1)
  })

  test('migrates legacy user-skills json into per-user skill folders', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-legacy-'))
    await writeFile(join(dataDir, 'user-skills.json'), JSON.stringify({
      version: 1,
      skillsByUserId: {
        user_legacy: [
          {
            id: 'skill_legacy',
            slug: 'legacy-skill',
            name: 'legacy-skill',
            description: 'Legacy skill.',
            enabled: true,
            files: [
              {
                path: 'SKILL.md',
                content: [
                  '---',
                  'name: legacy-skill',
                  'description: Legacy skill.',
                  '---',
                  '',
                  '# Legacy',
                ].join('\n'),
              },
            ],
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      },
    }), 'utf8')

    expect(listUserSkills('user_legacy', { dataDir }).map(skill => skill.slug))
      .toEqual(['legacy-skill'])
    await expect(readFile(
      join(dataDir, 'skills', 'user_legacy', 'legacy-skill', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Legacy')
    await expect(readFile(join(dataDir, 'user-skills.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dataDir, 'user-skills.json.legacy'), 'utf8')).resolves.toContain('legacy-skill')
  })

  test('migrates unscoped user skill folders into the skills root', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-unscoped-'))
    const userId = 'user_with_legacy_skill_dir'
    const legacySkillDir = join(dataDir, userId, 'threejs-fundamentals')
    await mkdir(join(legacySkillDir, 'files', 'references'), { recursive: true })
    await writeFile(join(legacySkillDir, 'skill.json'), JSON.stringify({
      id: 'skill_three',
      slug: 'threejs-fundamentals',
      name: 'threejs-fundamentals',
      description: 'Three.js fundamentals.',
      enabled: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    }), 'utf8')
    await writeFile(join(legacySkillDir, 'files', 'SKILL.md'), [
      '---',
      'name: threejs-fundamentals',
      'description: Three.js fundamentals.',
      '---',
      '',
      '# Three.js',
    ].join('\n'), 'utf8')

    expect(listUserSkills(userId, { dataDir }).map(skill => skill.slug))
      .toEqual(['threejs-fundamentals'])
    await expect(readFile(
      join(dataDir, 'skills', userId, 'threejs-fundamentals', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Three.js')
    await expect(readFile(join(dataDir, userId, 'threejs-fundamentals', 'files', 'SKILL.md'), 'utf8'))
      .rejects.toThrow()
  })

  test('removes stale materialized user skill folders', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-clean-'))
    const staleDir = join(dataDir, '.runtime', 'app', 'bgs', 'skills', 'user-stale-skill')
    await mkdir(staleDir, { recursive: true })
    await writeFile(join(staleDir, 'SKILL.md'), 'stale', 'utf8')
    materializeUserSkills([], { dataDir })
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'bgs', 'skills', 'user-stale-skill', 'SKILL.md'),
      'utf8',
    )).rejects.toThrow()
  })

  test('preserves nested reference documents across storage reload and materialization', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-nested-references-'))
    const userId = 'reference-owner'
    importUserSkill(userId, {
      files: parseSkillZipPackage(createSkillZip({
        'SKILL.md': [
          '---',
          'name: nested-references',
          'description: Uses a nested reference document.',
          '---',
          '',
          '# Nested references',
        ].join('\n'),
        'references/input/touch.md': '# Touch contract',
      })),
    }, { dataDir })

    const reloaded = listUserSkills(userId, { dataDir })
    expect(reloaded[0]?.files.map(file => file.path)).toEqual([
      'references/input/touch.md',
      'SKILL.md',
    ])

    materializeUserSkills(reloaded, { dataDir })
    await expect(readFile(join(
      dataDir,
      '.runtime',
      'app',
      'bgs',
      'skills',
      'user-nested-references',
      'references',
      'input',
      'touch.md',
    ), 'utf8')).resolves.toContain('# Touch contract')
  })

  test('materializes uploads directly in native home while preserving system and unmanaged Skills', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-native-skills-'))
    const native = join(dataDir, '.runtime', 'app', 'bgs', 'skills')
    for (const name of ['.system/imagegen', 'personal-method']) {
      await mkdir(join(native, name), {recursive:true})
      await writeFile(join(native, name, 'SKILL.md'), name)
    }
    const skill = importUserSkill('owner', {files:[{path:'SKILL.md',content:'---\nname: uploaded-method\ndescription: Synthetic upload.\n---\nMethod.'}]}, {dataDir})
    const legacy = join(dataDir, '.runtime', 'app', 'skills', 'user-uploaded-method')
    await mkdir(legacy,{recursive:true});await writeFile(join(legacy,'SKILL.md'),'Former copy')
    materializeUserSkills([skill], {dataDir})
    expect(await readFile(join(legacy,'SKILL.md'),'utf8')).toContain('Method.')
    expect(await realpath(legacy)).toBe(await realpath(join(native,'user-uploaded-method')))
    expect(await readFile(join(native, 'user-uploaded-method', 'SKILL.md'), 'utf8')).toContain('Method.')
    expect((await lstat(legacy)).isSymbolicLink()).toBe(true)
    materializeUserSkills([], {dataDir})
    expect(existsSync(join(native, 'user-uploaded-method'))).toBe(false)
    expect(existsSync(legacy)).toBe(false)
    expect(await readFile(join(native, '.system/imagegen/SKILL.md'), 'utf8')).toBe('.system/imagegen')
    expect(await readFile(join(native, 'personal-method/SKILL.md'), 'utf8')).toBe('personal-method')
  })
})

function createSkillZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strToU8(content)]),
  ))
}


test('3D helpers distinguish metadata from validation and protect source paths', async () => {
  const root = join(getBuiltinSkillsDirectory(), 'bgs-3d-asset', 'scripts')
  const metadata = join(root, 'validate_glb.py')
  const processor = join(root, 'process_asset.py')
  const code = `import json, runpy, struct, sys
from types import SimpleNamespace
inspect = runpy.run_path(sys.argv[1])['inspect_glb']
def glb(obj):
    body = json.dumps(obj).encode()
    body += b' ' * (-len(body) % 4)
    return SimpleNamespace(read_bytes=lambda: struct.pack('<4sIII4s', b'glTF', 2, 20 + len(body), len(body), b'JSON') + body)
def model(mode, index=0):
    return {'asset':{'version':'2.0'}, 'accessors':[{'count':12}], 'meshes':[{'primitives':[{'attributes':{'POSITION':0},'indices':index,'mode':mode}]}]}
for mode, expected in [(4,4),(5,10),(6,10)]:
    report = inspect(glb(model(mode)), 5)
    assert report['triangles'] == expected
    assert report['budget_met'] == (expected <= 5)
    assert report['structural_validation'] == 'not_run' and 'passed' not in report
# Declared counts are not proof that the absent buffers contain real geometry.
assert inspect(glb(model(4)))['structural_validation'] == 'not_run'
assert inspect(glb(model(4,-1)))['triangles'] is None
assert inspect(glb({'meshes':[{'primitives':[]}]}))['errors']
assert inspect(SimpleNamespace(read_bytes=lambda: b'bad'))['errors']
print('metadata boundaries verified')`
  const inspected = Bun.spawnSync(['python3', '-c', code, metadata])
  expect(inspected.exitCode).toBe(0)
  expect(inspected.stdout.toString()).toContain('metadata boundaries verified')
  for (const file of [metadata, processor]) {
    const original = await Bun.file(file).text()
    const args = file === processor
      ? ['--', '--input', file, '--output', file + '.output.glb', '--report', file, '--triangles', '1']
      : [file, '--json', file]
    const rejected = Bun.spawnSync(['python3', file, ...args])
    expect(rejected.exitCode).not.toBe(0)
    expect(rejected.stderr.toString()).toContain('paths must differ')
    expect(await Bun.file(file).text()).toBe(original)
  }
})


test('unchanged materialized Skills retain file identity; changed and removed files still synchronize',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-stable-skills-'))
  const files=[{path:'SKILL.md',content:'---\nname: stable\ndescription: Fixture.\n---\n# Stable'},
    {path:'references/keep.md',content:'Keep'},{path:'references/remove.md',content:'Remove'}]
  try{
    const skill=importUserSkill('owner',{files},{dataDir:root})
    materializeUserSkills([skill],{dataDir:root})
    const folder=join(root,'.runtime/app/bgs/skills/user-stable'),file=join(folder,'SKILL.md')
    const identity=(path:string)=>{const {ino,mtimeNs,ctimeNs}=statSync(path,{bigint:true});return{ino,mtimeNs,ctimeNs}}
    const keep=join(folder,'references/keep.md'),before=identity(file),keepBefore=identity(keep)
    materializeUserSkills([skill],{dataDir:root})
    expect(identity(file)).toEqual(before)
    expect(identity(keep)).toEqual(keepBefore)
    materializeUserSkills([{...skill,files:[{...files[0]!,content:files[0]!.content+'\nChanged'},files[1]!,{path:'references/new/extra.md',content:'Extra'}]}],{dataDir:root})
    expect(await readFile(file,'utf8')).toContain('Changed')
    expect(statSync(file,{bigint:true}).ino).not.toBe(before.ino)
    expect(identity(keep)).toEqual(keepBefore)
    expect(existsSync(join(folder,'references/remove.md'))).toBe(false)
    expect(await readFile(join(folder,'references/new/extra.md'),'utf8')).toBe('Extra\n')
    materializeUserSkills([{...skill,enabled:false}],{dataDir:root})
    expect(existsSync(folder)).toBe(false)
  }finally{await rm(root,{recursive:true,force:true})}
})
