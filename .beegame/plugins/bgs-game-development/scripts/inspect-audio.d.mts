export function inspectWav(bytes: Buffer, options?: { loopStartMs?: number; loopEndMs?: number }): {
  sha256: string; encoding: 'PCM16'; sampleRate: number; channelCount: number; frames: number; durationMs: number
  loop: { startFrame: number; endFrameExclusive: number; startMs: number; endMs: number }
  channels: {
    channel: number; peak: number; peakDbfs: number | null; rms: number; rmsDbfs: number | null
    dcMean: number; silent: boolean; fullScaleSamples: number
    leadingBelowMinus60DbMs: number; trailingBelowMinus60DbMs: number
    loopBoundary: { sampleJump: number; slopeChange: number; precedingRms: number; followingRms: number; windowFrames: number }
  }[]
  quality: 'unverified'; limitations: string
}
export function writeAudition(output: string, paths: string[]): Promise<{
  path: string; sources: string[]; quality: 'unverified'; note: string
}>
export const help: string
