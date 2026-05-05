/**
 * Session Tab Store — module-level state for multi-session tabs.
 *
 * Uses the useSyncExternalStore pattern (same as message-queue-store.ts).
 * Snapshot is cached to maintain referential stability across getSnapshot() calls.
 */

export interface SessionTabSnapshot {
  readonly tabs: readonly string[]
  readonly activeTabId: string | null
}

const MAX_TABS = parseInt(process.env.LITEAI_MAX_SESSION_TABS ?? "5", 10)

let tabs: string[] = []
let activeTabId: string | null = null

type Listener = () => void
const listeners = new Set<Listener>()

// Cached snapshot — only recreated on mutation to maintain referential stability
// for useSyncExternalStore. Without this, every getSnapshot() call returns a new
// object reference, causing infinite re-renders.
let cachedSnapshot: SessionTabSnapshot = { tabs, activeTabId }

function emit() {
  cachedSnapshot = { tabs, activeTabId }
  for (const l of listeners) {
    l()
  }
}

export const SessionTabStore = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  getSnapshot(): SessionTabSnapshot {
    return cachedSnapshot
  },

  /**
   * Add a tab or switch to an existing one.
   * Returns false if MAX_TABS would be exceeded (caller should show a toast).
   */
  addTab(id: string): boolean {
    if (tabs.includes(id)) {
      if (activeTabId !== id) {
        activeTabId = id
        emit()
      }
      return true
    }
    if (tabs.length >= MAX_TABS) {
      return false
    }
    tabs = [...tabs, id]
    activeTabId = id
    emit()
    return true
  },

  removeTab(id: string) {
    const idx = tabs.indexOf(id)
    if (idx === -1) return
    tabs = tabs.filter((t) => t !== id)
    if (activeTabId === id) {
      if (tabs.length > 0) {
        activeTabId = tabs[Math.min(idx, tabs.length - 1)]
      } else {
        activeTabId = null
      }
    }
    emit()
  },

  setActiveTab(id: string) {
    if (tabs.includes(id) && activeTabId !== id) {
      activeTabId = id
      emit()
    }
  },

  closeActiveTab() {
    if (activeTabId) {
      this.removeTab(activeTabId)
    }
  },

  /** Cycle to the next tab, wrapping around. */
  next() {
    if (tabs.length <= 1) return
    const idx = activeTabId ? tabs.indexOf(activeTabId) : 0
    const nextIdx = (idx + 1) % tabs.length
    activeTabId = tabs[nextIdx]
    emit()
  },

  /** Cycle to the previous tab, wrapping around. */
  prev() {
    if (tabs.length <= 1) return
    const idx = activeTabId ? tabs.indexOf(activeTabId) : 0
    const prevIdx = (idx - 1 + tabs.length) % tabs.length
    activeTabId = tabs[prevIdx]
    emit()
  },

  switchTabByIndex(index: number) {
    if (index >= 0 && index < tabs.length) {
      this.setActiveTab(tabs[index])
    }
  },

  getActiveSessionID(): string | undefined {
    return activeTabId ?? undefined
  },
}
