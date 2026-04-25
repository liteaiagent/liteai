import { useEffect, useMemo, useRef } from "react"
import { useDialog } from "../context/dialog"
import { useTheme } from "../context/theme"
import type { DialogSelectRef } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"

export function DialogTheme() {
  const { all, selected, set } = useTheme()
  const dialog = useDialog()

  const options = useMemo(() => {
    return Object.keys(all())
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      .map((value) => ({
        title: value,
        value: value,
      }))
  }, [all])

  const confirmed = useRef(false)
  const selectRef = useRef<DialogSelectRef<string>>(null)
  const initial = useRef(selected)

  useEffect(() => {
    return () => {
      if (!confirmed.current) set(initial.current)
    }
  }, [set])

  return (
    <DialogSelect
      title="Themes"
      options={options}
      current={initial.current}
      ref={selectRef}
      onMove={(opt) => {
        set(opt.value)
      }}
      onSelect={(opt) => {
        set(opt.value)
        confirmed.current = true
        dialog.clear()
      }}
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
