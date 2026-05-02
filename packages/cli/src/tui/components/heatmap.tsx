import { Box, type Color, Text } from "@liteai/ink"
import { useMemo } from "react"
import { useTheme } from "../context/theme"

const BLOCKS = [" ", "░", "▒", "▓", "█"]

interface HeatmapProps {
  dailyActivity: Map<string, number>
  weeks: number
  width: number
}

export function Heatmap({ dailyActivity, weeks, width }: HeatmapProps) {
  const { theme } = useTheme()

  const grid = useMemo(() => {
    const maxCount = Math.max(1, ...dailyActivity.values())
    const cells: { day: string; level: number }[][] = []

    const end = new Date()
    const start = new Date(end)
    start.setDate(start.getDate() - weeks * 7)

    for (let w = 0; w < weeks && w * 2 + 10 < width; w++) {
      const col: (typeof cells)[0] = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(start)
        date.setDate(date.getDate() + w * 7 + d)
        const key = date.toISOString().split("T")[0]
        const count = dailyActivity.get(key) ?? 0
        const level = Math.min(4, Math.ceil((count / maxCount) * 4))
        col.push({ day: key, level })
      }
      cells.push(col)
    }
    return cells
  }, [dailyActivity, weeks, width])

  return (
    <Box flexDirection="column">
      {[0, 1, 2, 3, 4, 5, 6].map((row) => (
        <Box key={`row-${row}`} flexDirection="row">
          {grid.map((col, w) => {
            const cell = col[row]
            if (!cell) return null
            const color = cell.level === 0 ? theme.textMuted : cell.level <= 2 ? theme.info : theme.success
            return (
              <Text key={`cell-${w}-${row}`} color={color as Color}>
                {BLOCKS[cell.level]}
                {BLOCKS[cell.level]}
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}
