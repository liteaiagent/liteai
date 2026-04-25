/** @jsxImportSource react */
import { useMemo } from "react"
import { useDialog } from "../context/dialog"
import { useLocal } from "../context/local"
import { DialogSelect } from "../ui/dialog-select"

export function DialogAgent() {
  const local = useLocal()
  const dialog = useDialog()

  const options = useMemo(
    () =>
      local.agent.list().map((item) => {
        return {
          value: item.name,
          title: item.name,
          description: item.native ? "native" : item.description,
        }
      }),
    [local.agent],
  )

  return (
    <DialogSelect
      title="Select agent"
      current={local.agent.current()?.name}
      options={options}
      onSelect={(option) => {
        local.agent.set(option.value)
        dialog.clear()
      }}
    />
  )
}
