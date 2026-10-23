export type DotState = 'idle' | 'listen' | 'think' | 'write' | 'success' | 'alert' | 'error' | 'sleep';
export interface DotAppearance { shape: string; eyes: string; brows: string; ink: string; size: number; gap: number; tilt: number; color: string; }
export function readDotToken(token: string): {o: DotAppearance; state: number} | null;
export interface DotRenderOptions {token: string; state: DotState; reduced: boolean; color: string; ink: string;}
export function animateDot(canvas: HTMLCanvasElement, options: DotRenderOptions): {update(options: DotRenderOptions): void; look(x: number, y: number): void; resetLook(): void; react(kind?: 'tap' | 'input' | 'hover'): void; dispose(): void;};
