import type { Color } from "@liteai/ink"
import { Box, Text } from "@liteai/ink"
import type React from "react"
import { useState } from "react"
import { selectedForeground, useTheme } from "../context/theme"
import type { RenderContext, SelectItem, SelectListProps } from "./types"

/**
 * Default item renderer used when no custom `renderItem` is provided.
 */
function DefaultSelectListItem<T>({
  item,
  context,
  showNumbers,
  numberColumnWidth,
}: {
  item: SelectItem<T>
  context: RenderContext
  showNumbers: boolean
  numberColumnWidth: number
}): React.ReactNode {
  const { theme } = useTheme()

  const numberText = showNumbers ? `${String(context.index + 1).padStart(numberColumnWidth)}.` : null

  return (
    <Box alignItems="flex-start">
      {/* Leading gutter (spinner, icon, tab number) */}
      {item.gutter ? (
        <Box minWidth={2} flexShrink={0}>
          {item.gutter}
        </Box>
      ) : (
        <Box minWidth={2} flexShrink={0}>
          <Text color={context.isActive ? (theme.primary as Color) : undefined}>{context.isActive ? "●" : " "}</Text>
        </Box>
      )}

      {/* Number column */}
      {numberText && (
        <Box marginRight={1} flexShrink={0} minWidth={numberText.length}>
          <Text color={(context.isActive ? context.titleColor : theme.textMuted) as Color}>{numberText}</Text>
        </Box>
      )}

      {/* Label + description */}
      <Box flexGrow={1} gap={1}>
        <Text bold={context.isActive} color={context.titleColor as Color}>
          {item.label}
        </Text>
        {item.description && (
          <Text color={(context.isActive ? context.titleColor : theme.textMuted) as Color}>{item.description}</Text>
        )}
      </Box>

      {/* Trailing footer */}
      {item.footer && (
        <Box flexShrink={0} marginLeft={1}>
          {typeof item.footer === "string" ? (
            <Text color={(context.isActive ? context.titleColor : theme.textMuted) as Color}>{item.footer}</Text>
          ) : (
            item.footer
          )}
        </Box>
      )}
    </Box>
  )
}

/**
 * A rendering component for selection lists that pairs with `useSelectList`.
 *
 * Handles:
 * - Scroll windowing with render-time derivation (no flicker)
 * - Default and custom item rendering via `renderItem`
 * - Number column display
 * - Scroll indicators (▲/▼)
 * - Category/group headers
 *
 * Does NOT handle input — that's `useSelectList`'s job.
 */
export function SelectList<T>({
  items,
  activeIndex,
  scrollOffset: externalScrollOffset,
  visibleCount = 10,
  renderItem,
  showNumbers = false,
  showScrollIndicators = false,
}: SelectListProps<T>): React.ReactNode {
  const { theme } = useTheme()
  const [scrollOffset, setScrollOffset] = useState(0)

  // Derive the effective scroll offset during render to avoid "no-selection" flicker.
  // This ensures that the visible window always includes the activeIndex.
  let effectiveScrollOffset = externalScrollOffset ?? scrollOffset
  if (activeIndex < effectiveScrollOffset) {
    effectiveScrollOffset = activeIndex
  } else if (activeIndex >= effectiveScrollOffset + visibleCount) {
    effectiveScrollOffset = Math.max(0, Math.min(activeIndex - visibleCount + 1, items.length - visibleCount))
  }

  // Synchronize internal state if it changed during derivation
  if (externalScrollOffset === undefined && effectiveScrollOffset !== scrollOffset) {
    setScrollOffset(effectiveScrollOffset)
  }

  const visibleItems = items.slice(effectiveScrollOffset, effectiveScrollOffset + visibleCount)
  const numberColumnWidth = String(items.length).length

  // Group items by category for rendering
  const hasCategories = items.some((item) => item.category)

  const showArrows = showScrollIndicators && items.length > visibleCount

  if (items.length === 0) {
    return (
      <Box paddingLeft={3}>
        <Text color={theme.textMuted as Color}>No results found</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {/* Up scroll indicator */}
      {showArrows && (
        <Box paddingLeft={2}>
          <Text color={(effectiveScrollOffset > 0 ? theme.text : theme.textMuted) as Color}>▲</Text>
        </Box>
      )}

      {visibleItems.map((item, visibleIdx) => {
        const itemIndex = effectiveScrollOffset + visibleIdx
        const isActive = activeIndex === itemIndex

        const titleColor = isActive
          ? selectedForeground(theme, theme.primary)
          : item.disabled
            ? theme.textMuted
            : theme.text

        const context: RenderContext = {
          isActive,
          titleColor,
          index: itemIndex,
        }

        // Category header — show if this item starts a new category group
        // and the list has categories
        let categoryHeader: React.ReactNode = null
        if (hasCategories && item.category) {
          const prevItemIndex = itemIndex - 1
          const prevItem = prevItemIndex >= 0 ? items[prevItemIndex] : null
          if (!prevItem || prevItem.category !== item.category) {
            categoryHeader = (
              <Box paddingTop={prevItem ? 1 : 0} paddingLeft={3}>
                <Text color={theme.accent as Color} bold>
                  {item.category}
                </Text>
              </Box>
            )
          }
        }

        return (
          <Box key={item.key} flexDirection="column">
            {categoryHeader}
            <Box backgroundColor={isActive ? (theme.primary as Color) : undefined} paddingLeft={1} paddingRight={1}>
              {renderItem ? (
                renderItem(item, context)
              ) : (
                <DefaultSelectListItem
                  item={item}
                  context={context}
                  showNumbers={showNumbers}
                  numberColumnWidth={numberColumnWidth}
                />
              )}
            </Box>
          </Box>
        )
      })}

      {/* Down scroll indicator */}
      {showArrows && (
        <Box paddingLeft={2}>
          <Text color={(effectiveScrollOffset + visibleCount < items.length ? theme.text : theme.textMuted) as Color}>
            ▼ {items.length - effectiveScrollOffset - visibleCount} more
          </Text>
        </Box>
      )}
    </Box>
  )
}
