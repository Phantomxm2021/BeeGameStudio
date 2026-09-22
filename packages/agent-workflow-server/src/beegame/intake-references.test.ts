import { expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Workbook } from 'exceljs'
import { intakeReferenceParts } from './intake-references'
import { validateBeeGameAttachments } from '../security/upload-policy'

const file = (filename: string, mediaType: string, bytes: Buffer) =>
  ({ type: 'file' as const, filename, mediaType, data: bytes.toString('base64') })
const textOf = (parts: Awaited<ReturnType<typeof intakeReferenceParts>>) =>
  parts.filter(part => part.type === 'text').map(part => part.text).join('\n')

test('preserves readable text and visual references without interpreting binary as UTF-8', async () => {
  const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#ffaa00' } }).png().toBuffer()
  const parts = await intakeReferenceParts([
    file('rules.md', 'text/markdown', Buffer.from('Keep the original rules.')),
    { type: 'image', mediaType: 'image/png', data: png.toString('base64'), filename: 'art.png' },
  ])
  expect(textOf(parts)).toContain('Keep the original rules.')
  expect(parts.filter(part => part.type === 'image')).toHaveLength(1)
})

test('extracts DOCX paragraphs and XLSX sheet/cell contents', async () => {
  const JSZip = createRequire(import.meta.resolve('exceljs'))('jszip')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Preserve blueprint mechanics</w:t></w:r></w:p></w:body></w:document>')
  const workbook = new Workbook()
  workbook.addWorksheet('Balance').addRow(['jump', 12])
  const parts = await intakeReferenceParts([
    file('design.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', await zip.generateAsync({ type: 'nodebuffer' })),
    file('balance.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await workbook.xlsx.writeBuffer())),
  ])
  expect(textOf(parts)).toContain('Preserve blueprint mechanics')
  expect(textOf(parts)).toContain('Sheet: Balance')
  expect(textOf(parts)).toContain('jump\t12')
})

test('extracts PDF text and rejects legacy binary documents explicitly', async () => {
  const stream = 'BT /F1 12 Tf 20 40 Td (Game rules) Tj ET'
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]
  let pdf = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n` })
  const xref = pdf.length
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => String(n).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  expect(textOf(await intakeReferenceParts([file('design.pdf', 'application/pdf', Buffer.from(pdf))]))).toContain('Game rules')
  await expect(intakeReferenceParts([file('old.doc', 'application/msword', Buffer.from('binary'))])).rejects.toThrow('Convert legacy')
})

test.skipIf(!Bun.which('ffmpeg') || !Bun.which('ffprobe'))('samples real video frames with timestamps and no audio playback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-reference-video-test-'))
  try {
    const path = join(root, 'reference.mp4')
    execFileSync(Bun.which('ffmpeg')!, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=yellow:s=32x32:r=10',
      '-t', '1', '-an', '-pix_fmt', 'yuv420p', path])
    const upload = file('reference.mp4', 'video/mp4', await readFile(path))
    expect(validateBeeGameAttachments([upload])).toHaveLength(1)
    const parts = await intakeReferenceParts([upload])
    expect(parts.filter(part => part.type === 'image')).toHaveLength(6)
    expect(textOf(parts)).toContain('not a full video or audio transcript')
  } finally { await rm(root, { recursive: true, force: true }) }
})
