import { type Component, Show } from "solid-js"
import { Button } from "./button"
import { useLanguage } from "../panes/shared/language"
import "./plan-approval-dock.css"

export interface PlanApprovalDockProps {
  description?: string
  onApprove: () => void
  onReject: () => void
}

export const PlanApprovalDock: Component<PlanApprovalDockProps> = (props) => {
  const language = useLanguage()

  return (
    <div class="plan-approval-dock bg-surface-raised-base border border-border-weak-base shadow-md-border rounded-[8px] p-3 mb-3 flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span class="text-11-medium text-icon-interactive-active uppercase tracking-wider">
          {language.t("session.plan.approvalRequired" as any) ?? "Plan Requires Approval"}
        </span>
      </div>
      <Show when={props.description}>
        <div class="text-13-regular text-text-strong whitespace-pre-wrap border-l-2 border-icon-interactive-active pl-2 overflow-y-auto max-h-[200px]">
          {props.description}
        </div>
      </Show>
      <div class="flex gap-2 justify-end mt-1">
        <Button variant="secondary" onClick={props.onReject}>
          {language.t("common.reject" as any) ?? "Reject Plan"}
        </Button>
        <Button variant="primary" onClick={props.onApprove}>
          {language.t("common.approve" as any) ?? "Approve Plan"}
        </Button>
      </div>
    </div>
  )
}
