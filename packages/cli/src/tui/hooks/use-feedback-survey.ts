import { useCallback, useEffect, useRef, useState } from "react"

/** Config for the feedback survey timing/pacing. */
const SURVEY_CONFIG = {
  /** Minimum user turns before first survey can appear. */
  minTurnsBeforeFirstSurvey: 5,
  /** Minimum turns between subsequent surveys. */
  minTurnsBetweenSurveys: 15,
  /** Minimum elapsed time (ms) before first survey. */
  minTimeBeforeFirstSurveyMs: 5 * 60_000,
  /** Minimum elapsed time (ms) between subsequent surveys. */
  minTimeBetweenSurveysMs: 30 * 60_000,
} as const

type SurveyState = "closed" | "open"

/**
 * Hook managing the feedback survey visibility lifecycle.
 *
 * Triggers the survey after a configurable number of user turns,
 * paced by both turn count and wall-clock time.
 */
export function useFeedbackSurvey(options: {
  /** Total number of user submissions this session. */
  submitCount: number
  /** Whether the model is currently generating. */
  isLoading: boolean
}): {
  state: SurveyState
  show: () => void
  dismiss: () => void
} {
  const { submitCount, isLoading } = options
  const [state, setState] = useState<SurveyState>("closed")

  // Timing refs
  const sessionStartRef = useRef(Date.now())
  const lastShownTimeRef = useRef<number | null>(null)
  const lastShownTurnRef = useRef<number | null>(null)

  const dismiss = useCallback(() => {
    setState("closed")
    lastShownTimeRef.current = Date.now()
    lastShownTurnRef.current = submitCount
  }, [submitCount])

  const show = useCallback(() => {
    setState("open")
  }, [])

  // Evaluate whether to show the survey
  useEffect(() => {
    if (state !== "closed") return
    if (isLoading) return

    const now = Date.now()
    const elapsed = now - sessionStartRef.current

    if (lastShownTimeRef.current === null) {
      // First appearance: require minimum turns and time
      if (submitCount < SURVEY_CONFIG.minTurnsBeforeFirstSurvey) return
      if (elapsed < SURVEY_CONFIG.minTimeBeforeFirstSurveyMs) return
    } else {
      // Subsequent: require pacing by both turns and time
      const turnsSinceLast = submitCount - (lastShownTurnRef.current ?? 0)
      const timeSinceLast = now - lastShownTimeRef.current
      if (turnsSinceLast < SURVEY_CONFIG.minTurnsBetweenSurveys) return
      if (timeSinceLast < SURVEY_CONFIG.minTimeBetweenSurveysMs) return
    }

    setState("open")
    lastShownTimeRef.current = now
    lastShownTurnRef.current = submitCount
  }, [submitCount, isLoading, state])

  return { state, show, dismiss }
}
