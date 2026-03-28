import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Filesystem } from "@liteai/core/util/filesystem"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, unknown>>({})
    const filePath = path.join(Global.Path.state, "kv.json")

    Filesystem.readJson<Record<string, unknown>>(filePath)
      .then((x) => {
        setStore(x)
      })
      .catch(() => {})
      .finally(() => {
        setReady(true)
      })

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          () => result.get(name) as T,
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: unknown) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: unknown) {
        setStore(key, value)
        Filesystem.writeJson(filePath, store)
      },
    }
    return result
  },
})
