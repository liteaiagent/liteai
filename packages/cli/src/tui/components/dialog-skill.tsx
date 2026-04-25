import type { ProjectSkillListResponse } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useDialog } from "../context/dialog"
import { useSDK } from "../context/sdk"
import type { DialogSelectOption } from "../ui/dialog-select"
import { DialogSelect } from "../ui/dialog-select"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
}

export function DialogSkill(props: DialogSkillProps) {
  const dialog = useDialog()
  const sdk = useSDK()

  useEffect(() => {
    dialog.setSize("large")
  }, [dialog])

  const [skills, setSkills] = useState<ProjectSkillListResponse>([])

  useEffect(() => {
    let active = true
    sdk.client.project.skill
      .list({ projectID: sdk.projectID })
      .then((result) => {
        if (active) {
          setSkills(result.data ?? [])
        }
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [sdk])

  const options = useMemo<DialogSelectOption<string>[]>(() => {
    const maxWidth = Math.max(0, ...skills.map((s) => s.name.length))
    return skills.map((skill) => ({
      title: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
      onSelect: () => {
        props.onSelect(skill.name)
        dialog.clear()
      },
    }))
  }, [skills, props, dialog])

  return <DialogSelect title="Skills" placeholder="Search skills..." options={options} />
}
