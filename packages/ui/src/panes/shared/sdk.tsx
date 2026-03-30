import type { Event } from "@liteai/sdk/client"
import { createGlobalEmitter } from "@solid-primitives/event-bus"
import { type Accessor, createEffect, createMemo, onCleanup } from "solid-js"
import { createSimpleContext } from "../../context"
import { useGlobalSDK } from "./global-sdk"

type SDKEventMap = {
  [key in Event["type"]]: Extract<Event, { type: key }>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: { directory: Accessor<string>; projectID: Accessor<string> }) => {
    const globalSDK = useGlobalSDK()

    const directory = createMemo(props.directory)
    const projectID = createMemo(props.projectID)
    const client = createMemo(() =>
      globalSDK.createClient({
        throwOnError: true,
      }),
    )

    const emitter = createGlobalEmitter<SDKEventMap>()

    createEffect(() => {
      const unsub = globalSDK.event.on(directory(), (event) => {
        emitter.emit(event.type, event)
      })
      onCleanup(unsub)
    })

    return {
      get directory() {
        return directory()
      },
      get projectID() {
        return projectID()
      },
      get client() {
        return client()
      },
      event: emitter,
      get url() {
        return globalSDK.url
      },
      createClient(opts: Parameters<typeof globalSDK.createClient>[0]) {
        return globalSDK.createClient(opts)
      },
    }
  },
})
