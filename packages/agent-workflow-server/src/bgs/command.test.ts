import { expect, test } from 'bun:test'
import { bgsCommand } from './client'

test('the operator Bgs binary applies to model-isolated environments and wins over session values', () => {
  const previous = process.env.BEEGAME_BGS_PATH
  try {
    process.env.BEEGAME_BGS_PATH = '/operator/source/target/debug/bgs'
    expect(bgsCommand({})).toEqual(['/operator/source/target/debug/bgs'])
    expect(bgsCommand({ BEEGAME_BGS_PATH: '/session/other-bgs' })).toEqual(['/operator/source/target/debug/bgs'])
    delete process.env.BEEGAME_BGS_PATH
    expect(bgsCommand({ BEEGAME_BGS_PATH: '/configured/bgs' })).toEqual(['/configured/bgs'])
    expect(bgsCommand({})).toHaveLength(1)
    expect(bgsCommand({})[0]).toEndWith(process.platform === 'win32' ? '/dist/bgs-runtime/bgs.exe' : '/dist/bgs-runtime/bgs')
  } finally {
    if (previous === undefined) delete process.env.BEEGAME_BGS_PATH
    else process.env.BEEGAME_BGS_PATH = previous
  }
})
