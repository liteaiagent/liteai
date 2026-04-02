import { WorkerPoolManager } from "@pierre/diffs/worker"
import ShikiWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"

export type WorkerPoolStyle = "unified" | "split"

// Workers fail silently in VS Code webviews due to CSP restrictions.
// The error is async (worker `error` event, not a thrown exception),
// so try-catch can't detect it. Instead, detect the environment upfront.
const isRestrictedEnv =
  typeof window !== "undefined" &&
  (window.location.protocol === "vscode-webview:" || "acquireVsCodeApi" in window)

export function workerFactory(): Worker {
  return new Worker(ShikiWorkerUrl, { type: "module" })
}

function createPool(lineDiffType: "none" | "word-alt") {
  const pool = new WorkerPoolManager(
    {
      workerFactory,
      // poolSize defaults to 8. More workers = more parallelism but
      // also more memory. Too many can actually slow things down.
      // NOTE: 2 is probably better for LiteAI, as I think 8 might be
      // a bit overkill, especially because Safari has a significantly slower
      // boot up time for workers
      poolSize: 2,
    },
    {
      theme: "LiteAI",
      lineDiffType,
      preferredHighlighter: "shiki-wasm",
    },
  )

  pool.initialize()
  return pool
}

let unified: WorkerPoolManager | undefined
let split: WorkerPoolManager | undefined

export function getWorkerPool(style: WorkerPoolStyle | undefined): WorkerPoolManager | undefined {
  if (typeof window === "undefined" || isRestrictedEnv) return

  if (style === "split") {
    if (!split) split = createPool("word-alt")
    return split
  }

  if (!unified) unified = createPool("none")
  return unified
}

export function getWorkerPools() {
  return {
    unified: getWorkerPool("unified"),
    split: getWorkerPool("split"),
  }
}
