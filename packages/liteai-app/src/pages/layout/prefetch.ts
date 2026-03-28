import { retry } from "@liteai/util/retry"
import type { Message, Session } from "@liteai/sdk/client"
import { type Accessor, batch, createEffect, untrack } from "solid-js"
import { produce, reconcile } from "solid-js/store"
import type { useGlobalSDK } from "@/context/global-sdk"
import type { useGlobalSync } from "@/context/global-sync"
import { dropSessionCaches, pickSessionCacheEvictions } from "@/context/global-sync/session-cache"
import {
  clearSessionPrefetch,
  clearSessionPrefetchInflight,
  getSessionPrefetch,
  isSessionPrefetchCurrent,
  runSessionPrefetch,
  setSessionPrefetch,
  shouldSkipSessionPrefetch,
} from "@/context/global-sync/session-prefetch"
import { toProjectID } from "@/utils/project-id"

type PrefetchQueue = {
  inflight: Set<string>
  pending: string[]
  pendingSet: Set<string>
  running: number
}

const chunk = 200
const concurrency = 2
const limit = 10
const span = 4
const MAX_PER_DIR = 10

export const mergeByID = <T extends { id: string }>(current: T[], incoming: T[]) => {
  if (current.length === 0) {
    return incoming.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  const map = new Map<string, T>()
  for (const item of current) {
    map.set(item.id, item)
  }
  for (const item of incoming) {
    map.set(item.id, item)
  }
  return [...map.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export type PrefetchDeps = {
  globalSDK: ReturnType<typeof useGlobalSDK>
  globalSync: ReturnType<typeof useGlobalSync>
  params: { projectID?: string; id?: string }
  visibleSessionDirs: Accessor<string[]>
}

export function createPrefetch(deps: PrefetchDeps) {
  const token = { value: 0 }
  const queues = new Map<string, PrefetchQueue>()
  const byDir = new Map<string, Set<string>>()

  const lruFor = (directory: string) => {
    const existing = byDir.get(directory)
    if (existing) return existing
    const created = new Set<string>()
    byDir.set(directory, created)
    return created
  }

  const markPrefetched = (directory: string, sessionID: string) => {
    const lru = lruFor(directory)
    return pickSessionCacheEvictions({
      seen: lru,
      keep: sessionID,
      limit: MAX_PER_DIR,
      preserve: directory === deps.params.projectID && deps.params.id ? [deps.params.id] : undefined,
    })
  }

  createEffect(() => {
    const active = new Set(deps.visibleSessionDirs())
    for (const directory of [...byDir.keys()]) {
      if (active.has(directory)) continue
      byDir.delete(directory)
    }
  })

  createEffect(() => {
    deps.params.projectID
    deps.globalSDK.url

    token.value += 1
    clearSessionPrefetchInflight()
    queues.clear()
  })

  createEffect(() => {
    const visible = new Set(deps.visibleSessionDirs())
    for (const [directory, q] of queues) {
      if (visible.has(directory)) continue
      q.pending.length = 0
      q.pendingSet.clear()
      if (q.running === 0) queues.delete(directory)
    }
  })

  const queueFor = (directory: string) => {
    const existing = queues.get(directory)
    if (existing) return existing

    const created: PrefetchQueue = {
      inflight: new Set(),
      pending: [],
      pendingSet: new Set(),
      running: 0,
    }
    queues.set(directory, created)
    return created
  }

  async function prefetchMessages(directory: string, sessionID: string, tok: number) {
    const [store, setStore] = deps.globalSync.child(directory, { bootstrap: false })

    return runSessionPrefetch({
      directory,
      sessionID,
      task: (rev) =>
        retry(() =>
          deps.globalSDK.client.project.session.messages({
            projectID: toProjectID(directory),
            sessionID,
            limit: chunk,
          }),
        )
          .then((messages) => {
            if (token.value !== tok) return
            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            const items = (messages.data ?? []).filter((x) => !!x?.info?.id)
            const next = items.map((x) => x.info).filter((m): m is Message => !!m?.id)
            const sorted = mergeByID([], next)
            const stale = markPrefetched(directory, sessionID)
            const cursor = messages.response.headers.get("x-next-cursor") ?? undefined
            const meta = {
              limit: sorted.length,
              cursor,
              complete: !cursor,
              at: Date.now(),
            }

            if (stale.length > 0) {
              clearSessionPrefetch(directory, stale)
              for (const id of stale) {
                deps.globalSync.todo.set(id, undefined)
              }
            }

            const current = store.message[sessionID] ?? []
            const merged = mergeByID(
              current.filter((item): item is Message => !!item?.id),
              sorted,
            )

            if (!isSessionPrefetchCurrent(directory, sessionID, rev)) return

            batch(() => {
              if (stale.length > 0) {
                setStore(
                  produce((draft) => {
                    dropSessionCaches(draft, stale)
                  }),
                )
              }

              setStore("message", sessionID, reconcile(merged, { key: "id" }))
              setSessionPrefetch({ directory, sessionID, ...meta })

              for (const message of items) {
                const currentParts = store.part[message.info.id] ?? []
                const mergedParts = mergeByID(
                  currentParts.filter((item): item is (typeof currentParts)[number] & { id: string } => !!item?.id),
                  message.parts.filter((item): item is (typeof message.parts)[number] & { id: string } => !!item?.id),
                )

                setStore("part", message.info.id, reconcile(mergedParts, { key: "id" }))
              }
            })

            return meta
          })
          .catch(() => undefined),
    })
  }

  const pump = (directory: string) => {
    const q = queueFor(directory)
    if (q.running >= concurrency) return

    const sessionID = q.pending.shift()
    if (!sessionID) return

    q.pendingSet.delete(sessionID)
    q.inflight.add(sessionID)
    q.running += 1

    const tok = token.value

    void prefetchMessages(directory, sessionID, tok).finally(() => {
      q.running -= 1
      q.inflight.delete(sessionID)
      pump(directory)
    })
  }

  const prefetchSession = (session: Session, priority: "high" | "low" = "low") => {
    const directory = session.directory
    if (!directory) return

    const [store] = deps.globalSync.child(directory, { bootstrap: false })
    const cached = untrack(() => {
      const info = getSessionPrefetch(directory, session.id)
      return shouldSkipSessionPrefetch({
        message: store.message[session.id] !== undefined,
        info,
        chunk,
      })
    })
    if (cached) return

    const q = queueFor(directory)
    if (q.inflight.has(session.id)) return
    if (q.pendingSet.has(session.id)) {
      if (priority !== "high") return
      const index = q.pending.indexOf(session.id)
      if (index > 0) {
        q.pending.splice(index, 1)
        q.pending.unshift(session.id)
      }
      return
    }

    const lru = lruFor(directory)
    const known = lru.has(session.id)
    if (!known && lru.size >= MAX_PER_DIR && priority !== "high") return

    if (priority === "high") q.pending.unshift(session.id)
    if (priority !== "high") q.pending.push(session.id)
    q.pendingSet.add(session.id)

    while (q.pending.length > limit) {
      const dropped = q.pending.pop()
      if (!dropped) continue
      q.pendingSet.delete(dropped)
    }

    pump(directory)
  }

  const warm = (sessions: Session[], index: number) => {
    for (let offset = 1; offset <= span; offset++) {
      const next = sessions[index + offset]
      if (next) prefetchSession(next, offset === 1 ? "high" : "low")

      const prev = sessions[index - offset]
      if (prev) prefetchSession(prev, offset === 1 ? "high" : "low")
    }
  }

  return { prefetchSession, warm }
}
