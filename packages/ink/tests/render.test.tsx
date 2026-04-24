import { expect, test } from 'bun:test'
import { Writable } from 'node:stream'
import stripAnsi from 'strip-ansi'
import { Box, renderSync, Text } from '../src/index.js'

class MockStream extends Writable {
  public columns = 80
  public rows = 24
  public isTTY = true
  public output = ''

  override _write(chunk: unknown, _encoding: string, callback: (error?: Error | null) => void) {
    this.output += String(chunk)
    callback()
  }
}

test('basic render', async () => {
  const stdout = new MockStream()

  const { unmount } = renderSync(
    <Box>
      <Text>HelloWorld</Text>
    </Box>,
    { stdout: stdout as unknown as NodeJS.WriteStream },
  )

  // Wait for microtask (Ink's render is deferred to microtask)
  await Promise.resolve()
  await Promise.resolve()

  unmount()

  // Check if output contains "HelloWorld"
  expect(stripAnsi(stdout.output)).toContain('HelloWorld')
})
