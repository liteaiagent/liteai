import { Box, type Color, stringWidth, Text, useAnimationFrame } from "@liteai/ink"
import React, { useRef, useState } from "react"
import { SPINNER_VERBS } from "../constants/spinner-phrases"
import { usePhraseCycler } from "../hooks/use-phrase-cycler"
import { useStalledAnimation } from "../hooks/use-stalled-animation"
import { formatElapsed, formatTokenCount } from "../util/format-elapsed"
import { computeGlimmerIndex, computeShimmerSegments } from "../util/shimmer"
import {
  interpolateColor,
  parseThemeColor,
  STALL_ERROR_RED,
  THINKING_BRIGHT,
  THINKING_DIM,
  toRGBString,
} from "../util/spinner-color"

const SPINNER_CHARS = ["·", "✢", "✳", "✶", "✻", "✽"]
export const SPINNER_FRAMES = [...SPINNER_CHARS, ...[...SPINNER_CHARS].reverse()]

function sample<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length) % arr.length] as T
}

export type SpinnerMode = "thinking" | "working" | "reading"

type SpinnerProps = {
  reducedMotion?: boolean
}

export function Spinner({ reducedMotion = false }: SpinnerProps): React.ReactNode {
  const [ref, time] = useAnimationFrame(reducedMotion ? null : 120)

  if (reducedMotion) {
    return (
      <Box ref={ref} flexWrap="wrap" height={1} width={2}>
        <Text>●</Text>
      </Box>
    )
  }

  const frame = Math.floor(time / 120) % SPINNER_FRAMES.length

  return (
    <Box ref={ref} flexWrap="wrap" height={1} width={2}>
      <Text>{SPINNER_FRAMES[frame]}</Text>
    </Box>
  )
}

type SpinnerGlyphProps = {
  frame: number
  color: string // Theme hex color
  stalledIntensity: number // 0–1
  reducedMotion: boolean
  time: number // For reduced-motion pulse
}

export function SpinnerGlyph({ frame, color, stalledIntensity, reducedMotion, time }: SpinnerGlyphProps) {
  let displayColor = color

  if (stalledIntensity > 0) {
    const rgb = parseThemeColor(color)
    const stalledRGB = interpolateColor(rgb, STALL_ERROR_RED, stalledIntensity)
    displayColor = toRGBString(stalledRGB)
  }

  if (reducedMotion) {
    // Pulse dim/bright on 2s period (2000ms)
    const pulseT = (Math.sin(((time % 2000) / 2000) * Math.PI * 2) + 1) / 2
    const rgb = parseThemeColor(color)
    const dimRGB = interpolateColor(rgb, { r: 50, g: 50, b: 50, a: 255 }, 0.5) // approx dim
    const pulseColor = interpolateColor(dimRGB, rgb, pulseT)
    const pColor = stalledIntensity > 0 ? displayColor : toRGBString(pulseColor)

    return (
      <Box width={2}>
        <Text color={pColor as Color}>●</Text>
      </Box>
    )
  }

  const char = SPINNER_FRAMES[frame % SPINNER_FRAMES.length]
  return (
    <Box width={2}>
      <Text color={displayColor as Color}>{char}</Text>
    </Box>
  )
}

type SpinnerAnimationRowProps = {
  message: string
  messageColor: string
  hasActiveTools: boolean
  responseLengthRef: React.RefObject<number>
  startTime: number
  columns: number
  reducedMotion: boolean
  thinkingStatus: "thinking" | number | null
}

export function SpinnerAnimationRow({
  message,
  messageColor,
  hasActiveTools,
  responseLengthRef,
  startTime,
  columns,
  reducedMotion,
  thinkingStatus,
}: SpinnerAnimationRowProps) {
  const [ref, time] = useAnimationFrame(50)
  const currentLength = responseLengthRef.current ?? 0

  // Mount guard — skip the very first render frame to avoid visual artifacts.
  // On mount, the animation frame hook returns the shared clock's current time
  // which produces valid but jarring initial frame/color values. The ref flips
  // to true after the first animation tick, giving the animation a clean start.
  const mountedRef = useRef(false)
  if (!mountedRef.current) {
    mountedRef.current = true
    return (
      <Box ref={ref} flexDirection="row" gap={1}>
        <SpinnerGlyph frame={0} color={messageColor} stalledIntensity={0} reducedMotion={reducedMotion} time={0} />
        <Text color={messageColor as Color} dim={true}>
          {message}
        </Text>
      </Box>
    )
  }

  const { isStalled, stalledIntensity } = useStalledAnimation(
    time,
    currentLength,
    hasActiveTools || thinkingStatus != null,
    reducedMotion,
  )

  const elapsedMs = Date.now() - startTime
  const isVeryStalled = isStalled && elapsedMs > 30000
  const displayMessage = isVeryStalled ? "Still working…" : message

  const frame = Math.floor(time / 120)
  const messageWidth = stringWidth(displayMessage)
  const glimmerIndex = computeGlimmerIndex(Math.floor(time / 200), messageWidth)

  const displayTokensRef = useRef(0)
  const targetTokens = Math.floor(currentLength / 4)
  if (displayTokensRef.current < targetTokens) {
    displayTokensRef.current = Math.min(
      targetTokens,
      displayTokensRef.current + Math.max(1, Math.floor((targetTokens - displayTokensRef.current) * 0.1)),
    )
  }

  const thinkingSine = (Math.sin(((time % 2000) / 2000) * Math.PI * 2) + 1) / 2
  const thinkingColor = toRGBString(interpolateColor(THINKING_DIM, THINKING_BRIGHT, thinkingSine))

  const { before, shimmer, after } = computeShimmerSegments(displayMessage, glimmerIndex)

  let msgColorHex = messageColor
  if (stalledIntensity > 0) {
    const baseRGB = parseThemeColor(messageColor)
    msgColorHex = toRGBString(interpolateColor(baseRGB, STALL_ERROR_RED, stalledIntensity))
  }

  const parts: React.ReactNode[] = []

  if (thinkingStatus === "thinking" || typeof thinkingStatus === "number") {
    parts.push(
      <Text key="thinking" color={thinkingColor as Color}>
        thinking
      </Text>,
    )
  }

  const elapsedStr = formatElapsed(elapsedMs)
  if (elapsedStr && columns >= 60) {
    parts.push(<Text key="time">{elapsedStr}</Text>)
  }

  if (displayTokensRef.current > 0 && columns >= 100) {
    parts.push(<Text key="tokens">↓ {formatTokenCount(displayTokensRef.current)} tokens</Text>)
  }

  const statusParts =
    parts.length > 0 ? (
      <Box flexDirection="row" gap={1}>
        <Text dim={true}>·</Text>
        {parts.map((part, i) => (
          <React.Fragment key={i}>
            {i > 0 && <Text dim={true}>·</Text>}
            {part}
          </React.Fragment>
        ))}
      </Box>
    ) : null

  return (
    <Box ref={ref} flexDirection="row" gap={1}>
      <SpinnerGlyph
        frame={frame}
        color={messageColor}
        stalledIntensity={stalledIntensity}
        reducedMotion={reducedMotion}
        time={time}
      />
      {reducedMotion || stalledIntensity > 0 ? (
        <Text color={msgColorHex as Color}>{displayMessage}</Text>
      ) : (
        <Text>
          <Text color={msgColorHex as Color} dim={true}>
            {before}
          </Text>
          <Text color={msgColorHex as Color}>{shimmer}</Text>
          <Text color={msgColorHex as Color} dim={true}>
            {after}
          </Text>
        </Text>
      )}
      {statusParts}
    </Box>
  )
}

export type RichSpinnerProps = {
  startTime: number
  responseLength: number
  hasActiveTools: boolean
  columns: number
  reducedMotion?: boolean
  thinkingStatus?: "thinking" | number | null
  themeColor?: string
}

export function RichSpinner({
  startTime,
  responseLength,
  hasActiveTools,
  columns,
  reducedMotion = false,
  thinkingStatus = null,
  themeColor = "#7c5cbf",
}: RichSpinnerProps) {
  const [verb] = useState(() => sample(SPINNER_VERBS))
  const responseLengthRef = useRef(responseLength)
  responseLengthRef.current = responseLength

  const { activeType, activeText } = usePhraseCycler({
    isActive: true,
    showTips: true,
    showWittyPhrases: true,
    maxLength: columns - 10,
  })

  const elapsedMs = Date.now() - startTime
  let tipLine: React.ReactNode = null

  if (elapsedMs > 10000 && activeText) {
    if (activeType === "witty") {
      tipLine = activeText
    } else if (activeType === "tip") {
      tipLine = `Tip: ${activeText}`
    }
  }

  const cancelHint = columns >= 80 ? "esc to cancel · " : ""

  return (
    <Box flexDirection="column">
      <SpinnerAnimationRow
        message={`${verb}…`}
        messageColor={themeColor}
        hasActiveTools={hasActiveTools}
        responseLengthRef={responseLengthRef}
        startTime={startTime}
        columns={columns}
        reducedMotion={reducedMotion}
        thinkingStatus={thinkingStatus}
      />
      {tipLine && (
        <Box paddingLeft={2}>
          <Text dim={true}>
            {cancelHint}
            {tipLine}
          </Text>
        </Box>
      )}
    </Box>
  )
}
