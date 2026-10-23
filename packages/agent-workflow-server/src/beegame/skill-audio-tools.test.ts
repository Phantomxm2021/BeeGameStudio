import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { noteHz, beatMs, phrase, repeatPhrase, partials, audioRequest } from '../../../../.beegame/skills/bgs-game-skills/game-audio-designer/scripts/compose-audio.mjs'
import { inspectWav } from '../../../../.beegame/skills/bgs-game-skills/game-audio-designer/scripts/inspect-audio.mjs'
import { arrangementStudy } from '../../../../.beegame/skills/bgs-game-skills/game-audio-designer/scripts/arrangement-study.mjs'
import { produceResources, renderAudioCue } from './resource-production'
import { parseBeeGameProgrammaticAudioResource } from './programmatic-audio-resource'

const scripts = fileURLToPath(new URL('../../../../.beegame/skills/bgs-game-skills/game-audio-designer/scripts/', import.meta.url))
const melody = [{ at: 0, beats: .5, note: 'A4' }, { at: 1, beats: .5, note: null },
  { at: 2, beats: 1, note: 'C5', velocity: .5 }]

test('note/beat helpers retain pitch, rests, velocity and explicit articulation', () => {
  expect(noteHz('A4')).toBe(440)
  expect(noteHz(69)).toBe(440)
  expect(noteHz('Bb3')).toBeCloseTo(noteHz('A#3'), 10)
  expect(noteHz('B#3')).toBeCloseTo(noteHz('C4'), 10)
  expect(beatMs(4, 80)).toBe(3000)
  const voices = phrase(melody, { bpm: 120, startBeat: 1, gain: .2, attackMs: 5, releaseMs: 50 })
  expect(voices).toHaveLength(2)
  expect(voices[0]).toMatchObject({ start_ms: 500, duration_ms: 250, gain: .2,
    source: { frequency_hz: 440 }, attack_ms: 5, release_ms: 50 })
  expect(voices[1]).toMatchObject({ start_ms: 1500, duration_ms: 500, gain: .1 })
  const repeated = repeatPhrase(melody, { bpm: 120, count: 2, periodBeats: 4 })
  expect(repeated.map(voice => voice.start_ms)).toEqual([0, 1000, 2000, 3000])
  expect(partials(220, [{ ratio: 1, durationMs: 200, gain: .1 },
    { ratio: 2.7, durationMs: 100, gain: .03 }], { attackMs: 2 })[1])
    .toMatchObject({ source: { frequency_hz: 594 }, release_ms: 98 })
})

test('invalid musical operands fail rather than silently clamp or invent values', () => {
  expect(() => noteHz('H4')).toThrow()
  expect(() => noteHz(128)).toThrow()
  expect(() => beatMs(1, 0)).toThrow()
  expect(() => phrase([{ at: 0, beats: .01, note: 'C4' }], { bpm: 120 })).toThrow('shorter')
  expect(() => phrase([{ at: -1, beats: 1, note: 'C4' }], { bpm: 120 })).toThrow()
  expect(() => repeatPhrase(melody, { bpm: 120, count: 129, periodBeats: 4 })).toThrow('256-voice')
  expect(() => partials(20_000, [{ ratio: 2, durationMs: 50, gain: .1 }])).toThrow('bounds')
})

test('helper output renders through the existing resource path and is inspectable PCM', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-skill-audio-render-'))
  try {
    const voices = repeatPhrase(melody, { bpm: 120, count: 2, periodBeats: 4 })
    const request = audioRequest([{ id: 'motif', duration_ms: 4000,
      loop: { start_ms: 0, end_ms: 4000 }, voices }], { motif: 'assets/runtime/motif.wav' }, 22050)
    expect(parseBeeGameProgrammaticAudioResource(request.recipe).cues).toHaveLength(1)
    const result = await produceResources(root, request) as any
    expect(result.valid).toBe(true)
    const bytes = await readFile(join(root, request.outputs.motif))
    const report = inspectWav(bytes)
    expect(report).toMatchObject({ durationMs: 4000, sampleRate: 22050, channelCount: 2, quality: 'unverified' })
    expect(report.channels.every(channel => !channel.silent && channel.rms > 0)).toBe(true)
    expect(inspectWav(bytes, { loopStartMs: 1000, loopEndMs: 3000 }).loop)
      .toMatchObject({ startFrame: 22050, endFrameExclusive: 66150 })
    const before = Buffer.from(bytes)
    inspectWav(bytes)
    expect(bytes).toEqual(before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('original arrangement retains authored rests and renders both resources without a quality verdict', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-skill-arrangement-'))
  try {
    const request = arrangementStudy()
    const parsed = parseBeeGameProgrammaticAudioResource(request.recipe)
    const music = parsed.cues.find(cue => cue.id === 'study-loop')!
    const placement = parsed.cues.find(cue => cue.id === 'study-place')!
    expect(music.duration_ms).toBe(10_000)
    expect(music.loop).toEqual({ start_ms: 0, end_ms: 10_000 })
    expect(placement.duration_ms).toBe(180)
    for (let bar = 0; bar < 4; bar++) {
      const restStart = beatMs(bar * 4 + 2.5, 96)
      const restEnd = beatMs((bar + 1) * 4, 96)
      expect(music.voices.some(voice => voice.start_ms < restEnd &&
        voice.start_ms + voice.duration_ms > restStart)).toBe(false)
    }
    expect(music.voices.some(voice => voice.source.type === 'oscillator' &&
      voice.source.frequency_hz === noteHz('D2'))).toBe(true)
    expect(music.voices.some(voice => voice.source.type === 'oscillator' &&
      voice.source.frequency_hz === noteHz('Bb4'))).toBe(true)
    const result = await produceResources(root, request) as any
    expect(result.valid).toBe(true)
    for (const cue of parsed.cues) {
      const bytes = await readFile(join(root, request.outputs[cue.id]))
      const report = inspectWav(bytes)
      expect(report).toMatchObject({ durationMs: cue.duration_ms, sampleRate: 44100,
        channelCount: 2, quality: 'unverified' })
      expect(report.channels.every(channel => !channel.silent)).toBe(true)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

function fixture(values: number[], rate = 1000) {
  const bytes = Buffer.alloc(44 + values.length * 2)
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  bytes.writeUInt32LE(values.length * 2, 40)
  values.forEach((value, index) => bytes.writeInt16LE(value, 44 + index * 2))
  return bytes
}

test('PCM diagnostics report silence, DC, level and selected seam without a taste verdict', () => {
  const silence = inspectWav(fixture([0, 0, 0, 0]))
  expect(silence.channels[0]).toMatchObject({ silent: true, peakDbfs: null, rmsDbfs: null, dcMean: 0 })
  const report = inspectWav(fixture([0, 8192, 16384, -8192]), { loopStartMs: 1, loopEndMs: 4 })
  expect(report.channels[0]).toMatchObject({ peak: .5, dcMean: .125, fullScaleSamples: 0,
    loopBoundary: { sampleJump: .5, precedingRms: .25, followingRms: .25 } })
  expect(report.channels[0].rms).toBeCloseTo(Math.sqrt(.09375), 8)
  expect(report.quality).toBe('unverified')
  expect(Number.isFinite(inspectWav(fixture([1, 2], 1)).channels[0].loopBoundary.precedingRms)).toBe(true)
})

test('truncated/unsupported WAVs and out-of-range loops are rejected', () => {
  const bytes = fixture([0, 1, 2, 3])
  expect(() => inspectWav(bytes.subarray(0, bytes.length - 1))).toThrow('complete')
  const wrongEncoding = Buffer.from(bytes); wrongEncoding.writeUInt16LE(3, 20)
  expect(() => inspectWav(wrongEncoding)).toThrow('PCM16')
  expect(() => inspectWav(bytes, { loopStartMs: 3, loopEndMs: 2 })).toThrow('range')
  expect(() => inspectWav(bytes, { loopEndMs: 5 })).toThrow('range')
  expect(() => inspectWav(bytes, { loopStartMs: .1, loopEndMs: .2 })).toThrow('two complete')
})

test('copied Skill scripts run in Node; audition preserves originals and refuses escapes/overwrite', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-skill-audio-package-')))
  try {
    await cp(scripts, join(root, 'installed/scripts'), { recursive: true })
    const compose = join(root, 'installed/scripts/compose-audio.mjs')
    const inspector = join(root, 'installed/scripts/inspect-audio.mjs')
    const run = async (file: string, args: string[]) => {
      const child = Bun.spawn(['node', file, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
      return { code: await child.exited, out: await new Response(child.stdout).text(), error: await new Response(child.stderr).text() }
    }
    const example = await run(compose, ['--example'])
    expect(example.code).toBe(0)
    const request = JSON.parse(example.out)
    const parsed = parseBeeGameProgrammaticAudioResource(request.recipe)
    const study = await run(join(root, 'installed/scripts/arrangement-study.mjs'), ['--example'])
    expect(study.code).toBe(0)
    expect(JSON.parse(study.out)).toEqual(arrangementStudy())
    expect((await run(join(root, 'installed/scripts/arrangement-study.mjs'), ['--unknown'])).code).not.toBe(0)
    const wav = renderAudioCue(parsed.cues[0]!, request.sampleRate).wav
    await mkdir(join(root, 'audio'))
    await writeFile(join(root, 'audio/a & b.wav'), wav)
    const inspected = await run(inspector, ['audio/a & b.wav'])
    expect(inspected.code).toBe(0)
    expect(JSON.parse(inspected.out).sha256).toBe(inspectWav(wav).sha256)
    const audition = await run(inspector, ['--audition', 'listen.html', 'audio/a & b.wav'])
    expect(audition.code).toBe(0)
    const page = await readFile(join(root, 'listen.html'), 'utf8')
    expect(page).toContain('src="audio/a%20%26%20b.wav"')
    expect(page).toContain('<audio controls preload="none"')
    expect(page).not.toContain('autoplay')
    expect(await readFile(join(root, 'audio/a & b.wav'))).toEqual(wav)
    expect((await run(inspector, ['--audition', 'listen.html', 'audio/a & b.wav'])).code).not.toBe(0)
    expect(await readFile(join(root, 'listen.html'), 'utf8')).toBe(page)
    await symlink(tmpdir(), join(root, 'outside'))
    expect((await run(inspector, ['--audition', 'outside/listen.html', 'audio/a & b.wav'])).code).not.toBe(0)
    const module = await import(pathToFileURL(inspector).href)
    await expect(module.writeAudition('../escape.html', ['audio/a & b.wav'])).rejects.toThrow('project-relative')
  } finally { await rm(root, { recursive: true, force: true }) }
})
