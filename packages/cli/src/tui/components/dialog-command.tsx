import { useInput } from "@liteai/ink"
import type React from "react"
import { createContext, useContext, useMemo, useRef, useState } from "react"
import { useDialog } from "../context/dialog"
import { type KeybindKey, useKeybind } from "../context/keybind"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"

export type Slash = {
  name: string
  aliases?: string[]
}

export type CommandOption = Omit<DialogSelectOption<string>, "onSelect"> & {
  keybind?: KeybindKey
  suggested?: boolean
  slash?: Slash
  hidden?: boolean
  enabled?: boolean
  onSelect?: (dialog: ReturnType<typeof useDialog>) => void
}

type CommandContextValue = {
  trigger(name: string): void
  slashes(): unknown[]
  keybinds(enabled: boolean): void
  suspended(): boolean
  show(): void
  register(cb: () => CommandOption[]): () => void
}

const CommandContext = createContext<CommandContextValue | undefined>(undefined)

export function useCommandDialog() {
  const value = useContext(CommandContext)
  if (!value) throw new Error("useCommandDialog must be used within a CommandProvider")
  return value
}

export function CommandProvider({ children }: { children: React.ReactNode }) {
  const [registrations, setRegistrations] = useState<(() => CommandOption[])[]>([])
  const [suspendCount, setSuspendCount] = useState(0)
  const dialog = useDialog()
  const keybind = useKeybind()

  const entries = useMemo(() => {
    const all = registrations.flatMap((cb) => cb())
    return all.map((x) => ({
      ...x,
      footer: x.keybind ? keybind.print(x.keybind) : undefined,
    }))
  }, [registrations, keybind])

  const isEnabled = (option: CommandOption) => option.enabled !== false
  const isVisible = (option: CommandOption) => isEnabled(option) && !option.hidden

  const visibleOptions = useMemo(() => entries.filter(isVisible), [entries])
  const suggestedOptions = useMemo(
    () =>
      visibleOptions
        .filter((option) => option.suggested)
        .map((option) => ({
          ...option,
          value: `suggested:${option.value}`,
          category: "Suggested",
        })),
    [visibleOptions],
  )

  const suspended = suspendCount > 0

  const value = useMemo<CommandContextValue>(() => {
    const result = {
      trigger(name: string) {
        for (const option of entries) {
          if (option.value === name) {
            if (!isEnabled(option)) return
            option.onSelect?.(dialog)
            return
          }
        }
      },
      slashes() {
        return visibleOptions.flatMap((option) => {
          const slash = option.slash
          if (!slash) return []
          return {
            display: `/${slash.name}`,
            description: option.description ?? option.title,
            aliases: slash.aliases?.map((alias) => `/${alias}`),
            onSelect: () => result.trigger(option.value),
          }
        })
      },
      keybinds(enabled: boolean) {
        setSuspendCount((count) => count + (enabled ? -1 : 1))
      },
      suspended() {
        return suspendCount > 0
      },
      show() {
        dialog.replace(() => <DialogCommand options={visibleOptions} suggestedOptions={suggestedOptions} />)
      },
      register(cb: () => CommandOption[]) {
        setRegistrations((arr) => [cb, ...arr])
        return () => {
          setRegistrations((arr) => arr.filter((x) => x !== cb))
        }
      },
    }
    return result
  }, [entries, visibleOptions, suggestedOptions, suspendCount, dialog])

  useInput((_char, _key, event) => {
    if (!event) return
    if (suspended) return
    if (dialog.stack.length > 0) return

    if (keybind.match("command_list", event.keypress)) {
      value.show()
      return
    }

    for (const option of entries) {
      if (!isEnabled(option)) continue
      if (option.keybind && keybind.match(option.keybind, event.keypress)) {
        option.onSelect?.(dialog)
        return
      }
    }
  })

  return <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
}

export function DialogCommand(props: { options: CommandOption[]; suggestedOptions: CommandOption[] }) {
  const ref = useRef<DialogSelectRef<string>>(null)
  const list = () => {
    // We check if it is being filtered currently. In SolidJS, ref?.filter returns boolean/string.
    // In React dialog-select, filtered items exist but if length is less than total, it's filtered.
    if (ref.current && ref.current.filtered.length < props.options.length) {
      return props.options as unknown as DialogSelectOption<string>[]
    }
    return [...props.suggestedOptions, ...props.options] as unknown as DialogSelectOption<string>[]
  }
  return <DialogSelect ref={ref} title="Commands" options={list()} />
}
