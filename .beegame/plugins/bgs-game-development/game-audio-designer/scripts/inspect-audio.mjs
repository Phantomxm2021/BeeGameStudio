import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Deliberately narrow: BGS-rendered PCM16 RIFF/WAVE, not a general decoder. */
export function inspectWav(bytes, { loopStartMs = 0, loopEndMs } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
      bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length)
    throw new Error('Expected a complete RIFF/WAVE file');
  let format, data;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('Truncated WAV chunk header');
    const id = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    const next = start + size + (size % 2);
    if (next > bytes.length) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (format || size < 16) throw new Error('Invalid or duplicate WAV format');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2),
        sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8),
        blockAlign: bytes.readUInt16LE(start + 12), bitDepth: bytes.readUInt16LE(start + 14) };
    }
    if (id === 'data') {
      if (data) throw new Error('Multiple WAV data chunks are unsupported');
      data = { start, size };
    }
    offset = next;
  }
  if (!format || !data || format.encoding !== 1 || format.bitDepth !== 16 ||
      ![1, 2].includes(format.channels) || !format.sampleRate ||
      format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRate * format.blockAlign ||
      !data.size || data.size % format.blockAlign)
    throw new Error('Supported input: non-empty mono/stereo PCM16 WAV with consistent frame metadata');
  const frames = data.size / format.blockAlign, durationMs = frames * 1000 / format.sampleRate;
  const endMs = loopEndMs ?? durationMs;
  if (!Number.isFinite(loopStartMs) || !Number.isFinite(endMs) || loopStartMs < 0 ||
      endMs <= loopStartMs || endMs > durationMs)
    throw new Error('Loop range must be within the decoded duration with start < end');
  const startFrame = Math.round(loopStartMs * format.sampleRate / 1000);
  const endFrame = Math.round(endMs * format.sampleRate / 1000);
  if (endFrame - startFrame < 2 || endFrame > frames) throw new Error('Loop range needs at least two complete frames');
  const sample = (frame, channel) => bytes.readInt16LE(data.start + frame * format.blockAlign + channel * 2) / 32768;
  const db = value => value === 0 ? null : 20 * Math.log10(value);
  const channels = Array.from({ length: format.channels }, (_, channel) => {
    let peak = 0, sum = 0, squares = 0, nonzero = 0, fullScaleSamples = 0;
    let firstAboveNoiseFloor = -1, lastAboveNoiseFloor = -1;
    for (let frame = 0; frame < frames; frame++) {
      const value = sample(frame, channel), magnitude = Math.abs(value);
      peak = Math.max(peak, magnitude); sum += value; squares += value * value;
      if (value !== 0) nonzero++;
      if (magnitude >= 32767 / 32768) fullScaleSamples++;
      if (magnitude > .001) { if (firstAboveNoiseFloor < 0) firstAboveNoiseFloor = frame; lastAboveNoiseFloor = frame; }
    }
    const rms = Math.sqrt(squares / frames);
    const window = Math.max(1, Math.min(Math.round(format.sampleRate * .01), Math.floor((endFrame - startFrame) / 2)));
    let beforeSquares = 0, afterSquares = 0;
    for (let index = 0; index < window; index++) {
      beforeSquares += sample(endFrame - window + index, channel) ** 2;
      afterSquares += sample(startFrame + index, channel) ** 2;
    }
    return { channel, peak, peakDbfs: db(peak), rms, rmsDbfs: db(rms), dcMean: sum / frames,
      silent: nonzero === 0, fullScaleSamples,
      leadingBelowMinus60DbMs: (firstAboveNoiseFloor < 0 ? frames : firstAboveNoiseFloor) * 1000 / format.sampleRate,
      trailingBelowMinus60DbMs: (lastAboveNoiseFloor < 0 ? frames : frames - lastAboveNoiseFloor - 1) * 1000 / format.sampleRate,
      loopBoundary: { sampleJump: sample(startFrame, channel) - sample(endFrame - 1, channel),
        slopeChange: (sample(startFrame + 1, channel) - sample(startFrame, channel)) -
          (sample(endFrame - 1, channel) - sample(endFrame - 2, channel)),
        precedingRms: Math.sqrt(beforeSquares / window), followingRms: Math.sqrt(afterSquares / window),
        windowFrames: window } };
  });
  return { sha256: createHash('sha256').update(bytes).digest('hex'), encoding: 'PCM16',
    sampleRate: format.sampleRate, channelCount: format.channels, frames, durationMs,
    loop: { startFrame, endFrameExclusive: endFrame, startMs: startFrame * 1000 / format.sampleRate,
      endMs: endFrame * 1000 / format.sampleRate }, channels,
    quality: 'unverified', limitations: 'PCM measurements only. Full-scale samples do not prove clipping; RMS is not perceptual loudness. Boundary differences are observations, not an audible seam verdict. Game timing, final mix and listening remain unverified.' };
}

async function projectFile(root, path) {
  const file = await realpath(resolve(root, path)), part = relative(root, file);
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part)) throw new Error('Select a file inside the current project');
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size > 100 * 1024 * 1024) throw new Error('Select a regular WAV file no larger than 100 MiB');
  // Read the already validated handle rather than following another link at read time.
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size)
      throw new Error('Audio source changed during inspection');
    return { file, path: part, bytes: await handle.readFile() };
  } finally { await handle.close(); }
}

const html = value => String(value).replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));

/** Original files, user-started native playback. No auto-play or synthetic game events. */
export async function writeAudition(output, paths) {
  const root = await realpath(process.cwd()), target = resolve(root, output), part = relative(root, target);
  if (!part || part === '..' || part.startsWith('..' + sep) || isAbsolute(part) || !target.endsWith('.html'))
    throw new Error('Choose a new project-relative .html file');
  if (await realpath(dirname(target)) !== dirname(target)) throw new Error('Audition parent must exist and have no symlink alias');
  if (!Array.isArray(paths) || !paths.length) throw new Error('Select at least one actual WAV');
  const files = [];
  for (const path of paths) {
    const source = await projectFile(root, path), report = inspectWav(source.bytes);
    const url = relative(dirname(target), source.file).split(sep).map(encodeURIComponent).join('/');
    files.push(`<section><h2>${html(source.path)}</h2><audio controls preload="none" src="${html(url)}"></audio>
<label><input type="checkbox" class="loop"> Repeat whole file</label><p>${report.durationMs.toFixed(1)} ms · ${report.sampleRate} Hz · ${report.channelCount} channel(s)</p>
<details><summary>PCM diagnostics</summary><pre>${html(JSON.stringify(report, null, 2))}</pre></details></section>`);
  }
  const page = `<!doctype html><meta charset="utf-8"><title>Audio audition</title>
<style>body{font:16px system-ui;max-width:900px;margin:24px auto;padding:0 16px}section{border-top:1px solid #aaa;padding:12px 0}audio{display:block;width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}label{display:block;margin:8px 0}</style>
<h1>Audio audition</h1><p>Start each original clip with its player control. Play clips together to hear their overlap. This page does not recreate game event timing, runtime gain, loop-point bindings or final game mix. Repeat uses the whole file; inspect authored loop ranges separately. File/source changes require a new inspection.</p>
<button id="stop">Stop all</button>${files.join('\n')}
<script>document.querySelectorAll('.loop').forEach(box=>box.addEventListener('change',()=>box.closest('section').querySelector('audio').loop=box.checked));document.getElementById('stop').addEventListener('click',()=>document.querySelectorAll('audio').forEach(audio=>{audio.pause();audio.currentTime=0}));</script>`;
  const handle = await open(target, 'wx', 0o600);
  try { await handle.writeFile(page); } finally { await handle.close(); }
  return { path: part, sources: paths, quality: 'unverified', note: 'New isolated audition page only. Open through an existing local preview or browser; playback requires user interaction.' };
}

export const help = `node <this-script> FILE.wav [--loop START_MS END_MS]
Read-only PCM16 diagnostics; omitted loop range measures the whole-file boundary.
node <this-script> --audition NEW.html FILE.wav [FILE.wav ...]
Creates one new page beside/relative to existing project WAVs. No overwrite, server, autoplay or model call.
Use the page for isolated/overlap listening, then check the same real player path in the actual game.
Unsupported codecs/PCM formats fail explicitly; use the game's decoder/tooling for those files.`;

const invokedFile = process.argv[1] ? await realpath(process.argv[1]).catch(() => undefined) : undefined;
if (invokedFile && import.meta.url === pathToFileURL(invokedFile).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === '--help') console.log(help);
    else if (args[0] === '--audition' && args.length >= 3) console.log(JSON.stringify(await writeAudition(args[1], args.slice(2)), null, 2));
    else if (args.length === 1 || args.length === 4 && args[1] === '--loop') {
      const source = await projectFile(await realpath(process.cwd()), args[0]);
      console.log(JSON.stringify({ path: source.path, ...inspectWav(source.bytes,
        args.length === 4 ? { loopStartMs: Number(args[2]), loopEndMs: Number(args[3]) } : {}) }, null, 2));
    } else throw new Error(help);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
