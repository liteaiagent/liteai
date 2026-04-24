/** @jsxImportSource react */
import path from "node:path"
import { Global } from "@liteai/core/global/index"
import { Filesystem } from "@liteai/core/util/filesystem"
import { useCallback, useEffect, useMemo, useState } from "react"
import { createSimpleContext } from "./helper"

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = useState(false)
    const [store, setStore] = useState<Record<string, unknown>>({})
    const filePath = useMemo(() => path.join(Global.Path.state, "kv.json"), [])

    useEffect(() => {
      Filesystem.readJson<Record<string, unknown>>(filePath)
        .then((x) => {
          setStore(x)
        })
        .catch(() => {})
        .finally(() => {
          setReady(true)
        })
    }, [filePath])

    const set = useCallback(
      (key: string, value: unknown) => {
        setStore((prev) => {
          const next = { ...prev, [key]: value }
          Filesystem.writeJson(filePath, next)
          return next
        })
      },
      [filePath],
    )

    const get = useCallback(
      (key: string, defaultValue?: unknown) => {
        return store[key] ?? defaultValue
      },
      [store],
    )

    const signal = useCallback(
      <T,>(name: string, defaultValue: T) => {
        if (store[name] === undefined) {
          set(name, defaultValue)
        }

        return [
          () => store[name] as T,
          (next: T | ((prev: T) => T)) => {
            if (typeof next === "function") {
              // @ts-expect-error
              set(name, next(store[name] as T))
            } else {
              set(name, next)
            }
          },
        ] as const
      },
      [store, set],
    )

    return useMemo(
      () => ({
        ready,
        store,
        get,
        set,
        signal,
      }),
      [ready, store, get, set, signal],
    )
  },
})
