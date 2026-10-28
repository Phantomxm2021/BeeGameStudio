import { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'

if (process.platform !== 'darwin') throw new Error('DMG packaging requires macOS.')
const desktop = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'))
const output = path.resolve(process.argv[2] || path.join(desktop, 'out'))
const architecture = process.argv[3] || process.arch
const application = path.join(output, `Bee Game Studio-darwin-${architecture}`, 'Bee Game Studio.app')
const destination = path.join(output, 'make', `BeeGameStudio-${version}-macOS-${architecture}.dmg`)
const temporary = await mkdtemp(path.join(os.tmpdir(), 'bgs-dmg-'))
try {
  await cp(application, path.join(temporary, 'Bee Game Studio.app'), { recursive: true, verbatimSymlinks: true })
  await symlink('/Applications', path.join(temporary, 'Applications'))
  await copyFile(path.join(desktop, 'assets/app-icon.icns'), path.join(temporary, '.VolumeIcon.icns'))
  await writeFile(path.join(temporary, '安装说明.txt'), '将 Bee Game Studio.app 拖到 Applications 文件夹完成安装。\nDrag Bee Game Studio.app to Applications to install.\n')
  await mkdir(path.dirname(destination), { recursive: true })
  await promisify(execFile)('/usr/bin/hdiutil', [
    'create', '-volname', 'Bee Game Studio', '-srcfolder', temporary,
    '-format', 'UDZO', '-ov', destination,
  ], { maxBuffer: 10 * 1024 * 1024 })
  console.log(destination)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
