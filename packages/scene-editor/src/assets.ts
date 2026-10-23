export function dataUri(bytes: Uint8Array, mimeType = 'application/octet-stream') { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return `data:${mimeType};base64,${btoa(binary)}` }
export function fromDataUri(uri: string) { const [, encoded] = uri.split(','); const binary = atob(encoded ?? ''); return Uint8Array.from(binary, char => char.charCodeAt(0)) }
