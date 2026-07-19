declare module 'assimpjs' {
  type AssimpFile = { GetContent(): Uint8Array }
  type AssimpResult = {
    IsSuccess(): boolean
    FileCount(): number
    GetFile(index: number): AssimpFile
    GetErrorCode(): string | number
  }
  type AssimpFileList = { AddFile(name: string, content: Uint8Array): void }
  type AssimpRuntime = {
    FileList: new () => AssimpFileList
    ConvertFileList(files: AssimpFileList, targetFormat: string): AssimpResult
  }
  export default function createAssimp(): Promise<AssimpRuntime>
}
