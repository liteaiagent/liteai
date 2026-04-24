/** @jsxImportSource react */
import { type DOMElement, type ParsedKey, useFocus, useInput } from "@liteai/ink"
import { useMemo, useRef, useState } from "react"
import { mapValues, pipe } from "remeda"
import { Keybind } from "../../cli/util/keybind"
import { createSimpleContext } from "./helper"
import { useTuiConfig } from "./tui-config"

export type KeybindKey = string

export const { use: useKeybind, provider: KeybindProvider } = createSimpleContext({
  name: "Keybind",
  init: () => {
    const config = useTuiConfig()
    const { activeElement, focus, blur } = useFocus()
    const [leaderActive, setLeaderActive] = useState(false)
    const blurredElementRef = useRef<DOMElement | null>(null)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const keybinds = useMemo(() => {
      return pipe(
        (config.keybinds ?? {}) as Record<string, string>,
        mapValues((value) => Keybind.parse(value)),
      )
    }, [config.keybinds])

    const setLeader = (active: boolean) => {
      if (active) {
        setLeaderActive(true)
        blurredElementRef.current = activeElement
        blur()

        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
          setLeader(false)
        }, 2000)
      } else {
        setLeaderActive(false)
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
        if (blurredElementRef.current) {
          focus(blurredElementRef.current)
        }
        blurredElementRef.current = null
      }
    }

    const result = useMemo(() => {
      const match = (keyName: string, evt: ParsedKey): boolean => {
        const bind = keybinds[keyName]
        if (!bind) return false

        const parse = (e: ParsedKey) => {
          if (e.name === "\x1F") {
            return Keybind.fromParsedKey({ ...e, name: "_", ctrl: true }, leaderActive)
          }
          return Keybind.fromParsedKey(e, leaderActive)
        }

        const parsed = parse(evt)
        return bind.some((b) => Keybind.match(b, parsed))
      }

      return {
        all: keybinds,
        leader: leaderActive,
        parse(evt: ParsedKey) {
          if (evt.name === "\x1F") {
            return Keybind.fromParsedKey({ ...evt, name: "_", ctrl: true }, leaderActive)
          }
          return Keybind.fromParsedKey(evt, leaderActive)
        },
        match,
        print(keyName: string) {
          const first = keybinds[keyName]?.at(0)
          if (!first) return ""
          const formatted = Keybind.format(first)
          const leaderBind = keybinds.leader?.[0]
          return leaderBind ? formatted.replace("<leader>", Keybind.format(leaderBind)) : formatted
        },
      }
    }, [keybinds, leaderActive])

    useInput((input, _key, event) => {
      if (!event) return

      if (!leaderActive && result.match("leader", event.keypress)) {
        setLeader(true)
        return
      }

      if (leaderActive && (input || event.keypress.name)) {
        setTimeout(() => {
          setLeader(false)
        }, 0)
      }
    })

    return result
  },
})
