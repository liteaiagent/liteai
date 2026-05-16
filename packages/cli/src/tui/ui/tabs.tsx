/**
 * Tabs — reusable tabbed layout component for the LiteAI TUI design system.
 *
 * Modeled on Claude Code's Tabs component with simplified API adapted to
 * LiteAI's keybinding and theme systems.
 *
 * Usage:
 * ```tsx
 * <Tabs selectedTab={tab} onTabChange={setTab} color={theme.primary}>
 *   <Tab title="Status">
 *     <StatusContent />
 *   </Tab>
 *   <Tab title="Config">
 *     <ConfigContent />
 *   </Tab>
 * </Tabs>
 * ```
 *
 * Navigation: left/right arrows switch tabs when header is focused.
 */

import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { createContext, useContext, useMemo } from "react"
import { useTheme } from "../context/theme"
import { useKeybindings } from "../keybindings/use-keybinding"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TabProps = {
  /** Tab label shown in the header bar. */
  title: string
  /** Optional unique id. Defaults to title if omitted. */
  id?: string
  /** Tab content — only rendered when this tab is selected. */
  children: React.ReactNode
}

export type TabsProps = {
  /** Tab children — must be <Tab> elements. */
  children: React.ReactElement<TabProps>[]
  /** Controlled mode: currently selected tab id/title. */
  selectedTab: string
  /** Controlled mode: callback when the user switches tab. */
  onTabChange: (tabId: string) => void
  /** Optional accent color for the active tab indicator. */
  color?: string
  /** Whether to suppress keyboard navigation (when child content binds arrows). */
  disableNavigation?: boolean
}

// ---------------------------------------------------------------------------
// Internal context — lets Tab read the selected state without prop drilling.
// ---------------------------------------------------------------------------

type TabsContextValue = {
  selectedTab: string
}

const TabsCtx = createContext<TabsContextValue>({ selectedTab: "" })

// ---------------------------------------------------------------------------
// Tabs component
// ---------------------------------------------------------------------------

export function Tabs(props: TabsProps) {
  const { theme } = useTheme()

  // Extract tab metadata from children
  const tabs = useMemo(
    () =>
      props.children.map((child) => ({
        id: child.props.id ?? child.props.title,
        title: child.props.title,
      })),
    [props.children],
  )

  const selectedIndex = useMemo(() => {
    const idx = tabs.findIndex((t) => t.id === props.selectedTab)
    return idx >= 0 ? idx : 0
  }, [tabs, props.selectedTab])

  const handleTabChange = (offset: number) => {
    const newIndex = (selectedIndex + tabs.length + offset) % tabs.length
    const newTabId = tabs[newIndex]?.id
    if (newTabId) {
      props.onTabChange(newTabId)
    }
  }

  useKeybindings(
    {
      "tabs:next": () => handleTabChange(1),
      "tabs:previous": () => handleTabChange(-1),
    },
    {
      context: "Tabs",
      isActive: !props.disableNavigation,
    },
  )

  const accentColor = (props.color ?? theme.primary) as Color

  const ctxValue = useMemo(() => ({ selectedTab: props.selectedTab }), [props.selectedTab])

  return (
    <TabsCtx.Provider value={ctxValue}>
      <Box flexDirection="column">
        {/* ─── Tab header row ─── */}
        <Box flexDirection="row" gap={1}>
          {tabs.map((tab, i) => {
            const isActive = i === selectedIndex
            return (
              <Text
                key={tab.id}
                bold={isActive}
                backgroundColor={isActive ? accentColor : undefined}
                color={isActive ? (theme.background as Color) : (theme.textMuted as Color)}
              >
                {" "}
                {tab.title}{" "}
              </Text>
            )
          })}
        </Box>

        {/* ─── Tab content ─── */}
        <Box marginTop={1}>{props.children}</Box>
      </Box>
    </TabsCtx.Provider>
  )
}

// ---------------------------------------------------------------------------
// Tab component — renders only when selected
// ---------------------------------------------------------------------------

export function Tab(props: TabProps) {
  const { selectedTab } = useContext(TabsCtx)
  const id = props.id ?? props.title

  if (selectedTab !== id) {
    return null
  }

  return <Box>{props.children}</Box>
}
