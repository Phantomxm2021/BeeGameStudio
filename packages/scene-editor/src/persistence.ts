import type { SceneDocument, SourceBinding } from './model'
import { clone } from './model'
import { assertSceneDocument } from './validation'

export interface ScenePackageV1 { packageSchemaVersion: 'scene-package.v1'; content: SceneDocument; assets: Record<string, { name: string; mimeType: string; path: string; data: string }>; exportedAt: string }
export function exportPackage(document: SceneDocument): ScenePackageV1 {
  canonicalJson(document)
  const assets: ScenePackageV1['assets'] = {}; for (const [id, asset] of Object.entries(document.assets)) if (asset.bytes) assets[id] = { name: asset.name, mimeType: asset.mimeType, path: asset.path, data: asset.bytes }
  return { packageSchemaVersion: 'scene-package.v1', content: clone(document), assets, exportedAt: new Date().toISOString() }
}
export function importPackage(input: ScenePackageV1): SceneDocument {
  if (!input || input.packageSchemaVersion !== 'scene-package.v1') throw Error('Unsupported scene package')
  if (!input.content || !input.assets || typeof input.assets !== 'object' || Array.isArray(input.assets)) throw Error('Invalid scene package content or assets')
  const doc = clone(input.content)
  assertSceneDocument(doc)
  for (const [id, asset] of Object.entries(input.assets)) {
    const declared = doc.assets[id]
    if (!declared || !asset || typeof asset.data !== 'string' || asset.name !== declared.name || asset.mimeType !== declared.mimeType || asset.path !== declared.path) throw Error(`Package asset ${id} does not match its content declaration`)
    if (declared.bytes !== undefined && declared.bytes !== asset.data) throw Error(`Package asset ${id} has conflicting bytes`)
    doc.assets[id] = { ...declared, bytes: asset.data }
  }
  assertSceneDocument(doc)
  // A content package is a materialized snapshot; derive its actual identity
  // so externally edited content cannot replay patches for a former baseline.
  doc.source.contentRevision = String(doc.revision)
  const payload = clone(doc); payload.source.contentDigest = ''
  doc.source.contentDigest = sha256Sync(canonicalJson(payload))
  return doc
}

/** Creates a deliberately blank authoring document. Demo fixtures stay test-only. */
export function makeEmptyScene(id = 'scene-empty', name = 'Untitled Scene'): SceneDocument {
  const fixtureDigest = sha256Sync(canonicalJson({ schemaVersion: 'scene-game-object.v2', dimension: '3d', id, name }))
  const source: SourceBinding = { source: { kind: 'fixture', fixtureId: 'empty-scene-v1', fixtureDigest }, contentDigest: '', contentRevision: '0', contentSchemaVersion: 'beegame-content-v1', adapterId: 'three-scene-v1', adapterVersion: '1.0.0' }
  const document: SceneDocument = { schemaVersion: 'scene-game-object.v2', dimension: '3d', id, name, revision: 0, source, rootIds: [], nodes: {}, assets: {}, diagnostics: [] }
  const digestable = clone(document); digestable.source.contentDigest = ''; document.source.contentDigest = sha256Sync(canonicalJson(digestable))
  assertSceneDocument(document)
  return document
}
export function canonicalJson(value: unknown): string { if (value === null) return 'null'; if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value); if (typeof value === 'number') { if (!Number.isFinite(value)) throw Error('Cannot canonicalize non-finite number'); return JSON.stringify(value) } if (typeof value !== 'object' || value === undefined) throw Error('Cannot canonicalize non-JSON value'); if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; const proto = Object.getPrototypeOf(value); if (proto !== Object.prototype && proto !== null) throw Error('Cannot canonicalize non-plain object'); return `{${Object.keys(value as Record<string, unknown>).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}` }
const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
export function sha256Sync(input: string): string { const data = new TextEncoder().encode(input), bitLen = data.length * 8, padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6); padded.set(data); padded[data.length] = 0x80; const dv = new DataView(padded.buffer); dv.setUint32(padded.length - 4, bitLen, false); let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]; const rotr=(x:number,n:number)=>(x>>>n)|(x<<(32-n)); for(let o=0;o<padded.length;o+=64){const w=new Uint32Array(64);for(let i=0;i<16;i++)w[i]=dv.getUint32(o+i*4,false);for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2],s0=rotr(a,7)^rotr(a,18)^(a>>>3),s1=rotr(b,17)^rotr(b,19)^(b>>>10);w[i]=(w[i-16]+s0+w[i-7]+s1)>>>0}let[a,b,c,d,e,f,g,j]=h;for(let i=0;i<64;i++){const S1=rotr(e,6)^rotr(e,11)^rotr(e,25),ch=(e&f)^(~e&g),t1=(j+S1+ch+K[i]+w[i])>>>0,S0=rotr(a,2)^rotr(a,13)^rotr(a,22),maj=(a&b)^(a&c)^(b&c),t2=(S0+maj)>>>0;j=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0}h=h.map((v,i)=> (v+[a,b,c,d,e,f,g,j][i])>>>0)} return h.map(v=>v.toString(16).padStart(8,'0')).join('') }

/** Compare authored content, independent of undo revisions and patch bookkeeping. */
export function sceneContentKey(document: SceneDocument): string {
  const { revision, appliedTransactions, source, ...content } = document
  const { contentDigest, contentRevision, ...binding } = source
  return canonicalJson({ ...content, source: binding })
}
