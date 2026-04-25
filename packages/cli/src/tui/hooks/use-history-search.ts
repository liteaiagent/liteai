import fuzzysort from "fuzzysort"
import { useCallback, useEffect, useRef, useState } from "react"
import { useSDK } from "../context/sdk"

export type HistoryEntry = {
  display: string
  sessionID: string
  timestamp: number
}

export function useHistorySearch() {
  const sdk = useSDK()
  const [isSearching, setIsSearching] = useState(false)
  const [query, setQuery] = useState("")
  const [match, setMatch] = useState<HistoryEntry | undefined>(undefined)

  // bufferVersion is a state counter that increments when the buffer loads,
  // so the fuzzy-search useEffect re-runs when data arrives mid-search.
  const bufferRef = useRef<HistoryEntry[]>([])
  const [bufferVersion, setBufferVersion] = useState(0)
  const isLoadedRef = useRef(false)

  // Start search
  const startSearch = useCallback(() => {
    setIsSearching(true)
    setQuery("")
    setMatch(undefined)

    // Fire and forget loading the buffer
    if (!isLoadedRef.current) {
      sdk.client.project.session
        .history({ projectID: sdk.projectID })
        .then((res) => {
          bufferRef.current = res.data ?? []
          isLoadedRef.current = true
          setBufferVersion((v) => v + 1)
        })
        .catch(() => {
          // Silently degrade — search will have no results
        })
    }
  }, [sdk])

  // Cancel search
  const cancelSearch = useCallback(() => {
    setIsSearching(false)
    setQuery("")
    setMatch(undefined)
  }, [])

  // Fuzzy match when query changes or buffer loads
  useEffect(() => {
    if (!isSearching) return
    if (!query) {
      setMatch(undefined)
      return
    }

    const results = fuzzysort.go(query, bufferRef.current, {
      key: "display",
      limit: 1,
    })

    if (results.length > 0 && results[0]) {
      setMatch(results[0].obj)
    } else {
      setMatch(undefined)
    }
  }, [query, isSearching, bufferVersion])

  return {
    isSearching,
    query,
    setQuery,
    match,
    startSearch,
    cancelSearch,
  }
}
