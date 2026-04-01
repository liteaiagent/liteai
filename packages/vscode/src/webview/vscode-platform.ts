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
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url

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
            // Normal response.
            // HTTP statuses 101, 204, 205, 304 are "null body" statuses per the
            // Fetch spec — constructing a Response with a body for these throws
            // "Response with null body status cannot have body".
            const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])
            const body = NULL_BODY_STATUSES.has(msg.status) || !msg.body ? null : new Uint8Array(msg.body)
            const response = new Response(body, {
              status: msg.status,
              statusText: msg.statusText,
              headers: new Headers(msg.headers),
            })
            resolve(response)
          }
        }
      }

      window.addEventListener("message", handleMessage)

      // When the SDK passes a Request object as `input` (with no `init`),
      // we must read method/headers/body from the Request itself.
      // This is a key difference vs a plain URL+init call.
      const req = !init && input instanceof Request ? (input as Request) : null

      const method = init?.method ?? req?.method ?? "GET"

      // Merge headers into a plain object for postMessage serialization
      const rawHeaders: Record<string, string> = {}
      const initHeaders = init?.headers ?? req?.headers
      if (initHeaders instanceof Headers) {
        initHeaders.forEach((value, key) => {
          rawHeaders[key] = value
        })
      } else if (initHeaders && typeof initHeaders === "object") {
        for (const [k, v] of Object.entries(initHeaders)) {
          if (v != null) rawHeaders[k] = v as string
        }
      }

      // Body: init.body is used when explicitly passed; otherwise read from Request.
      // For a Request object, body must be consumed via .text() (JSON strings only).
      const sendMessage = (body: string | undefined) => {
        vscode.postMessage({
          type: "fetch",
          id,
          url,
          method,
          headers: rawHeaders,
          body,
        })
      }

      if (req && !req.bodyUsed && req.body) {
        req
          .text()
          .then(sendMessage)
          .catch(() => sendMessage(undefined))
      } else {
        const body = init?.body
        sendMessage(typeof body === "string" ? body : body != null ? String(body) : undefined)
      }
    })
  }) as Platform["fetch"],
}

/**
 * Send an arbitrary postMessage to the extension host.
 * Use this for non-fetch IPC (e.g. search-files, vscode-command).
 * The `vscode` object from `acquireVsCodeApi()` is module-scoped and can only
 * be obtained once — this helper shares that single instance.
 */
export function vscodePlatformPostMessage(message: unknown): void {
  vscode.postMessage(message)
}
