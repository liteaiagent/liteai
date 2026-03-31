import type { Platform } from "@liteai/ui/panes"

// Acquire VS Code API to send postMessages
declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void
}
const vscode = acquireVsCodeApi()

export const vscodePlatform: Platform = {
  platform: "vscode",
  openLink(url: string) {
    vscode.postMessage({ type: "vscode-command", command: "openLink", args: { url } })
  },
  async restart() {
    vscode.postMessage({ type: "vscode-command", command: "restart" })
  },
  back() {},
  forward() {},
  async notify(title: string, description?: string, href?: string) {
    vscode.postMessage({ type: "vscode-command", command: "notify", args: { title, description, href } })
  },
  openFile(path: string) {
    vscode.postMessage({ type: "vscode-command", command: "openFile", args: { path } })
  },
  // We implement fetch by proxying it to the extension host by an ID.
  // Cast needed because Bun's `typeof fetch` includes `preconnect` which
  // doesn't exist on a plain async function signature.
  fetch: (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return new Promise((resolve, reject) => {
      const id = Date.now().toString() + Math.random().toString()
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

      const handleMessage = (event: MessageEvent) => {
        const msg = event.data
        if (msg && msg.type === "fetch-response" && msg.id === id) {
          window.removeEventListener("message", handleMessage)
          if (msg.error) {
            reject(new Error(msg.error))
            return
          }

          // Check if it's SSE
          if (msg.headers?.["content-type"]?.includes("text/event-stream")) {
            // We return a mocked stream response
            let controller: ReadableStreamDefaultController
            const stream = new ReadableStream({
              start(c) {
                controller = c
              },
            })

            const sseListener = (sseEvent: MessageEvent) => {
              const sseMsg = sseEvent.data
              if (sseMsg && sseMsg.type === "fetch-chunk" && sseMsg.id === id) {
                if (sseMsg.done) {
                  window.removeEventListener("message", sseListener)
                  controller.close()
                } else if (sseMsg.chunk) {
                  controller.enqueue(new Uint8Array(sseMsg.chunk))
                }
              }
            }
            window.addEventListener("message", sseListener)

            const response = new Response(stream, {
              status: msg.status,
              statusText: msg.statusText,
              headers: new Headers(msg.headers),
            })
            resolve(response)
          } else {
            // Normal response
            const response = new Response(msg.body ? new Uint8Array(msg.body) : null, {
              status: msg.status,
              statusText: msg.statusText,
              headers: new Headers(msg.headers),
            })
            resolve(response)
          }
        }
      }

      window.addEventListener("message", handleMessage)

      vscode.postMessage({
        type: "fetch",
        id,
        url,
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body, // Assumes body is string or undefined (ArrayBuffer etc. need special handling but SDK sends JSON)
      })
    })
  }) as Platform["fetch"],
}
