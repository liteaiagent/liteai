import { useRef } from "react"

export function useStalledAnimation(
  time: number,
  responseLength: number,
  suppressStall: boolean,
  reducedMotion: boolean,
): { isStalled: boolean; stalledIntensity: number } {
  const lastResponseLength = useRef(responseLength)
  // Initialize to current animation clock time — not Date.now() — so stall
  // detection pauses automatically when the terminal is backgrounded (ADR-1).
  const lastTokenTime = useRef(time)
  const smoothedIntensity = useRef(0)

  if (responseLength > lastResponseLength.current) {
    lastResponseLength.current = responseLength
    lastTokenTime.current = time
  }

  if (suppressStall) {
    lastTokenTime.current = time
    smoothedIntensity.current = 0
    return { isStalled: false, stalledIntensity: 0 }
  }

  const elapsed = time - lastTokenTime.current

  let target = 0
  if (elapsed >= 3000) {
    target = Math.min(1, (elapsed - 3000) / 2000)
  }

  if (reducedMotion) {
    smoothedIntensity.current = target
  } else {
    smoothedIntensity.current += (target - smoothedIntensity.current) * 0.1
  }

  return {
    isStalled: smoothedIntensity.current > 0,
    stalledIntensity: smoothedIntensity.current,
  }
}
