import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useEffect, useMemo, useState } from "react"
import { useSession } from "../context/session"
import { useSync } from "../context/sync"
import { TextInput } from "./text-input"

export function TranscriptSearch(props: {
  onClose: () => void
  onNavigate: (messageID: string) => void
}): React.ReactNode {
  const [query, setQuery] = useState("")
  const [currentIndex, setCurrentIndex] = useState(0)
  const session = useSession()
  const sync = useSync()

  const sessionID = session.sessionID
  const messages = useMemo(() => {
    if (!sessionID) return []
    return sync.message[sessionID] ?? []
  }, [sessionID, sync.message])

  const parts = sync.part

  const matches = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const results: string[] = []
    for (const msg of messages) {
      const msgParts = parts[msg.id] ?? []
      let text = ""
      for (const p of msgParts) {
        if (p.type === "text") text += p.text
        else if (p.type === "tool" && p.state.status === "completed" && typeof p.state.output === "string") {
          text += p.state.output
        }
      }
      if (text.toLowerCase().includes(q)) {
        results.push(msg.id)
      }
    }
    return results
  }, [query, messages, parts])

  useEffect(() => {
    if (matches.length > 0) {
      const idx = Math.min(currentIndex, matches.length - 1)
      setCurrentIndex(idx)
      props.onNavigate(matches[idx])
    }
  }, [matches, currentIndex, props.onNavigate])

  return (
    <Box flexDirection="row" borderStyle="round" borderColor={"cyan" as Color} paddingX={1} gap={1}>
      <Text dim>Transcript Search:</Text>
      <Box flexGrow={1}>
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={() => {
            if (matches.length > 0) {
              const next = (currentIndex + 1) % matches.length
              setCurrentIndex(next)
              props.onNavigate(matches[next])
            }
          }}
          onHistoryUp={() => {
            if (matches.length > 0) {
              const prev = (currentIndex - 1 + matches.length) % matches.length
              setCurrentIndex(prev)
              props.onNavigate(matches[prev])
            }
          }}
          onHistoryDown={() => {
            if (matches.length > 0) {
              const next = (currentIndex + 1) % matches.length
              setCurrentIndex(next)
              props.onNavigate(matches[next])
            }
          }}
          onExit={props.onClose}
          placeholder="Type to search..."
        />
      </Box>
      {query.trim() && <Text dim>{matches.length > 0 ? `${currentIndex + 1}/${matches.length}` : "No matches"}</Text>}
      <Text dim> | ↑/↓ or Enter to navigate | Esc to close</Text>
    </Box>
  )
}
