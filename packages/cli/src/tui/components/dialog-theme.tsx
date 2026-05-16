import { useEffect, useMemo, useRef } from "react"
import { useTheme } from "../context/theme"
import type { SelectPaneRef } from "../ui/select-pane"
import { SelectPane } from "../ui/select-pane"

type Props = {
  onClose: () => void
}

export function DialogTheme({ onClose }: Props) {
  const { all, selected, set } = useTheme()

  const options = useMemo(() => {
    return all()
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({
        key: value,
        label: value,
        value: value,
      }))
  }, [all])

  const confirmed = useRef(false)
  const selectRef = useRef<SelectPaneRef<string>>(null)
  const initial = useRef(selected)

  useEffect(() => {
    return () => {
      if (!confirmed.current) set(initial.current)
    }
  }, [set])

  return (
    <SelectPane
      title="Themes"
      items={options}
      current={initial.current}
      ref={selectRef}
      onHighlight={(item) => {
        set(item.value)
      }}
      onSelect={(item) => {
        set(item.value)
        confirmed.current = true
        onClose()
      }}
      onClose={onClose}
      onFilter={(query) => {
        if (query.length === 0) {
          set(initial.current)
          return
        }

        const first = selectRef.current?.filtered[0]
        if (first) set(first.value)
      }}
    />
  )
}
