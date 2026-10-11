import { expect, mock, test, spyOn } from 'bun:test'
import type { Subprocess } from 'bun'
import { initializeSSHProcess } from '../SSHInitialization'
import { remoteExecutable, shellQuote } from '../../utils/shellArgument'

function fixture(options: { fail?: boolean; silent?: boolean; split?: boolean } = {}) {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  let output = ''
  const kill = mock(() => {})
  const proc = {
    stdout: new ReadableStream<Uint8Array>({ start(c) { controller = c } }),
    stdin: { write(bytes: Uint8Array) {
      const request = JSON.parse(new TextDecoder().decode(bytes))
      expect(request.request.subtype).toBe('initialize')
      if (options.silent) return bytes.length
      output = JSON.stringify({ type: 'control_response', response: {
        subtype: options.fail ? 'error' : 'success', request_id: request.request_id, error: 'fixture failure',
      } }) + '\n' + JSON.stringify({ type: 'assistant', message: '完整消息✓' }) + '\npartial'
      const encoded = encoder.encode(output)
      if (options.split) { controller.enqueue(encoded.slice(0, 10)); controller.enqueue(encoded.slice(10)) }
      else controller.enqueue(encoded)
      controller.close()
      return bytes.length
    }, flush() {} }, kill,
  } as unknown as Subprocess
  return { proc, kill, output: () => output }
}

test.each([false, true])('SDK handshake preserves all output, including same-chunk messages and partial lines (split=%s)', async split => {
  const f = fixture({ split })
  const initialized = await initializeSSHProcess(f.proc)
  expect(await new Response(initialized.stdout as ReadableStream).text()).toBe(f.output())
  expect(f.kill).not.toHaveBeenCalled()
})

test('failed SDK initialize kills the child instead of leaking reconnect processes', async () => {
  const f = fixture({ fail: true })
  await expect(initializeSSHProcess(f.proc)).rejects.toThrow('fixture failure')
  expect(f.kill).toHaveBeenCalledTimes(1)
})

test('no initialize response times out and kills the child', async () => {
  const f = fixture({ silent: true })
  await expect(initializeSSHProcess(f.proc, 10)).rejects.toThrow('timed out')
  expect(f.kill).toHaveBeenCalledTimes(1)
  expect((f.proc.stdout as ReadableStream).locked).toBe(false)
})

test('aborting an in-flight handshake stops the process without waiting for timeout', async () => {
  const f = fixture({ silent: true })
  const controller = new AbortController()
  const pending = initializeSSHProcess(f.proc, 30_000, controller.signal)
  controller.abort()
  await expect(pending).rejects.toThrow()
  expect(f.kill).toHaveBeenCalledWith('SIGKILL')
  expect((f.proc.stdout as ReadableStream).locked).toBe(false)
})

test('an already aborted handshake does not write an initialize request', async () => {
  const f = fixture({ silent: true })
  const write = spyOn(f.proc.stdin as unknown as { write(data: Uint8Array): number }, 'write')
  const controller = new AbortController()
  controller.abort()
  await expect(initializeSSHProcess(f.proc, 30_000, controller.signal)).rejects.toThrow()
  expect(write).not.toHaveBeenCalled()
  expect(f.kill).toHaveBeenCalledWith('SIGKILL')
})

test('remote shell arguments are literal, not executable syntax', () => {
  const value = "a b'; printf BGS_INJECTION; #\n$HOME"
  const child = Bun.spawnSync(['/bin/sh', '-c', `printf '%s' ${shellQuote(value)}`], { stdout: 'pipe' })
  expect(child.exitCode).toBe(0)
  expect(child.stdout.toString()).toBe(value)
  expect(remoteExecutable('~/a b')).toBe('"$HOME"/\'a b\'')
})
