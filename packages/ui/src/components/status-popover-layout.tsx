import type { JSXElement } from "solid-js"
import { Button } from "./button"
import { Icon } from "./icon"
import { Popover } from "./popover"
import { Tabs } from "./tabs"

export interface StatusPopoverLayoutProps {
  open: boolean
  onOpenChange: (open: boolean) => void

  overallHealthy: boolean
  serverHealthy?: boolean

  triggerAriaLabel?: string
  tabsAriaLabel?: string

  mcpCount: number
  mcpLabel: string
  mcpContent: JSXElement

  lspCount: number
  lspLabel: string
  lspContent: JSXElement
}

export function StatusPopoverLayout(props: StatusPopoverLayoutProps) {
  return (
    <Popover
      open={props.open}
      onOpenChange={props.onOpenChange}
      triggerAs={Button}
      triggerProps={{
        variant: "ghost",
        class: "titlebar-icon w-8 h-6 p-0 box-border",
        "aria-label": props.triggerAriaLabel ?? "Status",
        style: { scale: 1 },
      }}
      trigger={
        <div class="relative size-4">
          <div class="badge-mask-tight size-4 flex items-center justify-center">
            <Icon name={props.open ? "status-active" : "status"} size="small" />
          </div>
          <div
            classList={{
              "absolute -top-px -right-px size-1.5 rounded-full": true,
              "bg-icon-success-base": props.overallHealthy,
              "bg-icon-critical-base": !props.overallHealthy,
            }}
          />
        </div>
      }
      class="[&_[data-slot=popover-body]]:p-0 w-[360px] max-w-[calc(100vw-40px)] bg-transparent border-0 shadow-none rounded-xl"
      gutter={4}
      placement="bottom-end"
      shift={-168}
    >
      <div class="flex items-center gap-1 w-[360px] rounded-xl shadow-[var(--shadow-lg-border-base)]">
        <Tabs
          aria-label={props.tabsAriaLabel ?? "Status"}
          class="tabs bg-background-strong rounded-xl overflow-hidden"
          data-component="tabs"
          data-active="mcp"
          defaultValue="mcp"
          variant="alt"
        >
          <Tabs.List data-slot="tablist" class="bg-transparent border-b-0 px-4 pt-2 pb-0 gap-4 h-10">
            <Tabs.Trigger value="mcp" data-slot="tab" class="text-12-regular">
              {props.mcpCount > 0 ? `${props.mcpCount} ` : ""}
              {props.mcpLabel}
            </Tabs.Trigger>
            <Tabs.Trigger value="lsp" data-slot="tab" class="text-12-regular">
              {props.lspCount > 0 ? `${props.lspCount} ` : ""}
              {props.lspLabel}
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="mcp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">{props.mcpContent}</div>
            </div>
          </Tabs.Content>

          <Tabs.Content value="lsp">
            <div class="flex flex-col px-2 pb-2">
              <div class="flex flex-col p-3 bg-background-base rounded-sm min-h-14">{props.lspContent}</div>
            </div>
          </Tabs.Content>
        </Tabs>
      </div>
    </Popover>
  )
}
