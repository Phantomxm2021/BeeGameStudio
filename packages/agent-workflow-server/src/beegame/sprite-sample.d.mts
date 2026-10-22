export function spriteClip(atlas: unknown, frameMs: number, ids: string[], size: { w: number; h: number }): {
  frameMs: number; frames: { id: string; x: number; y: number; w: number; h: number }[]; width: number; height: number
}
