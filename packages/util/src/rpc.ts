export namespace Rpc {
  type Definition = {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic RPC dispatch
    [method: string]: (input: any) => any
  }

  export function listen(rpc: Definition) {
    self.onmessage = async (evt) => {
      if (typeof self !== "undefined" && self.location && evt.origin && evt.origin !== self.location.origin) {
        return
      }
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.request") {
        const method = parsed.method
        if (typeof method === "string" && typeof rpc[method] === "function" && Object.hasOwn(rpc, method)) {
          const result = await rpc[method](parsed.input)
          postMessage(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
        } else {
          throw new Error(`Forbidden RPC method invocation: ${method}`)
        }
      }
    }
  }

  export function emit(event: string, data: unknown) {
    postMessage(JSON.stringify({ type: "rpc.event", event, data }))
  }

  export function client<T extends Definition>(target: {
    postMessage: (data: string) => undefined | null
    // biome-ignore lint/suspicious/noExplicitAny: Worker onmessage signature
    onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null
  }) {
    // biome-ignore lint/suspicious/noExplicitAny: dynamic pending resolution
    const pending = new Map<number, (result: any) => void>()
    // biome-ignore lint/suspicious/noExplicitAny: dynamic event data
    const listeners = new Map<string, Set<(data: any) => void>>()
    let id = 0
    target.onmessage = async (evt) => {
      const parsed = JSON.parse(evt.data)
      if (parsed.type === "rpc.result") {
        const resolve = pending.get(parsed.id)
        if (resolve) {
          resolve(parsed.result)
          pending.delete(parsed.id)
        }
      }
      if (parsed.type === "rpc.event") {
        const handlers = listeners.get(parsed.event)
        if (handlers) {
          for (const handler of handlers) {
            handler(parsed.data)
          }
        }
      }
    }
    return {
      call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
        const requestId = id++
        return new Promise((resolve) => {
          pending.set(requestId, resolve)
          target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
        })
      },
      on<Data>(event: string, handler: (data: Data) => void) {
        let handlers = listeners.get(event)
        if (!handlers) {
          handlers = new Set()
          listeners.set(event, handlers)
        }
        handlers.add(handler)
        return () => {
          handlers?.delete(handler)
        }
      },
    }
  }
}
