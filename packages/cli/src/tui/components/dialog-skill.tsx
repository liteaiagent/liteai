import type { ProjectSkillListResponse } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useSDK } from "../context/sdk"
import type { SelectItem } from "../primitives/types"
import { SelectPane } from "../ui/select-pane"

export type DialogSkillProps = {
  onSelect: (skill: string) => void
  onClose: () => void
}

export function DialogSkill(props: DialogSkillProps) {
  const sdk = useSDK()

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

  const items = useMemo<SelectItem<string>[]>(() => {
    const maxWidth = Math.max(0, ...skills.map((s) => s.name.length))
    return skills.map((skill) => ({
      key: skill.name,
      label: skill.name.padEnd(maxWidth),
      description: skill.description?.replace(/\s+/g, " ").trim(),
      value: skill.name,
      category: "Skills",
    }))
  }, [skills])

  return (
    <SelectPane
      title="Skills"
      placeholder="Search skills..."
      items={items}
      onSelect={(item) => {
        props.onSelect(item.value)
        props.onClose()
      }}
      onClose={props.onClose}
    />
  )
}
