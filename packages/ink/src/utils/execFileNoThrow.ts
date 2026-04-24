import { type ExecaError, execa } from 'execa'

type ExecFileOptions = {
  timeout?: number
  input?: string
}

export function execFileNoThrow(
  file: string,
  args: string[],
  options: ExecFileOptions = {
    timeout: 10 * 60 * 1000,
  },
): Promise<{ stdout: string; stderr: string; code: number; error?: string }> {
  return new Promise((resolve) => {
    execa(file, args, {
      timeout: options.timeout,
      input: options.input,
      reject: false,
    })
      .then((result) => {
        if (result.failed) {
          const errorCode = result.exitCode ?? 1
          void resolve({
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            code: errorCode,
            error: result.shortMessage || String(errorCode),
          })
        } else {
          void resolve({
            stdout: result.stdout,
            stderr: result.stderr,
            code: 0,
          })
        }
      })
      .catch((error: ExecaError) => {
        void resolve({ stdout: '', stderr: '', code: 1, error: error.message })
      })
  })
}
