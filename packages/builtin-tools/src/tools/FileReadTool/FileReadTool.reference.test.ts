import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache'
import { FileReadTool } from './FileReadTool'

test('native Read sends reference pixels to the model and reports missing or empty pictures',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bgs-native-picture-read-'))
  const previous=process.env.BGS_SIMPLE
  process.env.BGS_SIMPLE='1'
  try {
    const path=join(root,'参考图 #1.PNG')
    const bytes=await sharp({create:{width:8,height:8,channels:4,background:'red'}}).png().toBuffer()
    await writeFile(path,bytes)
    const context={readFileState:createFileStateCacheWithSizeLimit(1)} as Parameters<typeof FileReadTool.call>[1]
    const result=await FileReadTool.call({file_path:path},context)
    expect(result.data.type).toBe('image')
    if(result.data.type!=='image') throw Error('Read did not return image content')
    const block=FileReadTool.mapToolResultToToolResultBlockParam(result.data,'reference-read')
    expect(block).toMatchObject({type:'tool_result',content:[{type:'image',source:{type:'base64',media_type:'image/png'}}]})
    const decoded=await sharp(Buffer.from(result.data.file.base64,'base64')).metadata()
    expect([decoded.width,decoded.height]).toEqual([8,8])
    await expect(FileReadTool.call({file_path:join(root,'missing.PNG')},context)).rejects.toThrow('File does not exist')
    await writeFile(path,'')
    await expect(FileReadTool.call({file_path:path},context)).rejects.toThrow('Image file is empty')
  } finally {
    if(previous===undefined) delete process.env.BGS_SIMPLE
    else process.env.BGS_SIMPLE=previous
    await rm(root,{recursive:true,force:true})
  }
})
