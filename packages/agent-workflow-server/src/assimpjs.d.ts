declare module 'assimpjs' {
  type AssimpResultFile = {
    GetPath(): string
    GetContent(): Uint8Array
  }
  type AssimpResult = {
    IsSuccess(): boolean
    FileCount(): number
    GetFile(index: number): AssimpResultFile
    GetErrorCode(): string
  }
  type AssimpFileList = {
    AddFile(name: string, bytes: Uint8Array): void
  }
  type AssimpModule = {
    FileList: new () => AssimpFileList
    ConvertFileList(files: AssimpFileList, targetFormat: string): AssimpResult
  }
  export default function createAssimp(): Promise<AssimpModule>
}
