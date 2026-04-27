import { InstanceBootstrap } from "@liteai/core/project/bootstrap"
import { Instance } from "@liteai/core/project/instance"
import { Runtime } from "@liteai/core/runtime"

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  await Runtime.boot()
  return Instance.provide({
    directory,
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
        await Runtime.shutdown()
      }
    },
  })
}
