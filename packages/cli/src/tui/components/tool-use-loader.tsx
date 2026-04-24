import { Box, type Color, Text } from "@liteai/ink"
import type React from "react"
import { useTheme } from "../context/theme.tsx"
import { useBlink } from "../hooks/useBlink.ts"

type Props = {
  isError: boolean
  isUnresolved: boolean
  shouldAnimate: boolean
}

const BLACK_CIRCLE = "●"

export function ToolUseLoader({ isError, isUnresolved, shouldAnimate }: Props): React.ReactNode {
  const { theme } = useTheme()
  const [ref, isBlinking] = useBlink(shouldAnimate)

  const color: Color | undefined = isUnresolved
    ? undefined
    : isError
      ? (theme.error as Color)
      : (theme.success as Color)

  // WARNING: The code here and in AssistantToolUseMessage is particularly
  // sensitive to what *should* just be trivial refactorings. A `<dim>x</dim>`
  // followed *immediately* by `<bold>y</bold>` tag incorrectly renders `y` as
  // dim! This is because `</dim>` and `</bold>` are both reset by \x1b[22m
  // due to historical reasons, and chalk can't distinguish between them.
  // The symptom you'll see if we get this wrong is the tool name blinks along
  // with this loading indicator, which looks quite bad.
  // https://github.com/chalk/chalk/issues/290
  return (
    <Box ref={ref} minWidth={2}>
      <Text color={color} dim={isUnresolved}>
        {!shouldAnimate || isBlinking || isError || !isUnresolved ? BLACK_CIRCLE : " "}
      </Text>
    </Box>
  )
}
