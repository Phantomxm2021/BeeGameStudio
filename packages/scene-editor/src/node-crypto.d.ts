declare module 'node:crypto' {
  export function createHash(algorithm: string): { update(value: string | Uint8Array): { digest(encoding: 'hex'): string } }
}
