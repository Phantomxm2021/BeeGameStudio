declare module 'assimpjs' {
  type AssimpResultFile = { GetContent(): Uint8Array; GetFileName?(): string }
  type AssimpConversionResult = { IsSuccess(): boolean; FileCount(): number; GetErrorCode(): string; GetFile(index: number): AssimpResultFile }
  type AssimpFileList = { AddFile(name: string, content: Uint8Array): void }
  type AssimpModule = { FileList: new () => AssimpFileList; ConvertFileList(files: AssimpFileList, format: 'glb2'): AssimpConversionResult }
  const createAssimp: (options?: { locateFile?: (path: string) => string }) => Promise<AssimpModule>
  export default createAssimp
}
