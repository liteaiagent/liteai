import { useEffect, useRef, useState } from "react"
import { INFORMATIVE_TIPS, WITTY_PHRASES } from "../constants/spinner-phrases"

function sample<T>(arr: T[], exclude?: T): T | undefined {
  if (arr.length === 0) return undefined
  let candidates = arr
  if (exclude !== undefined && arr.length > 1) {
    candidates = arr.filter((item) => item !== exclude)
  }
  return candidates[Math.floor(Math.random() * candidates.length)]
}

export function usePhraseCycler(props: {
  isActive: boolean
  showTips?: boolean
  showWittyPhrases?: boolean
  maxLength?: number
}): { activeType: "tip" | "witty" | null; activeText: string | null } {
  const { isActive, showTips = true, showWittyPhrases = true, maxLength } = props

  const [activePhrase, setActivePhrase] = useState<{ type: "tip" | "witty"; text: string } | null>(null)

  const lastTip = useRef<string | undefined>(undefined)
  const lastWitty = useRef<string | undefined>(undefined)

  // Tips cycle every 10s
  useEffect(() => {
    if (!isActive || !showTips) {
      return
    }

    const tick = () => {
      const tips = maxLength ? INFORMATIVE_TIPS.filter((t) => t.length <= maxLength) : INFORMATIVE_TIPS
      if (tips.length > 0) {
        const tip = sample(tips, lastTip.current)
        if (tip) {
          lastTip.current = tip
          setActivePhrase({ type: "tip", text: tip })
        }
      }
    }

    const interval = setInterval(tick, 10000)
    return () => clearInterval(interval)
  }, [isActive, showTips, maxLength])

  // Witty phrases cycle every 5s
  useEffect(() => {
    if (!isActive || !showWittyPhrases) {
      return
    }

    const tick = () => {
      const phrases = maxLength ? WITTY_PHRASES.filter((p) => p.length <= maxLength) : WITTY_PHRASES
      if (phrases.length > 0) {
        const phrase = sample(phrases, lastWitty.current)
        if (phrase) {
          lastWitty.current = phrase
          setActivePhrase({ type: "witty", text: phrase })
        }
      }
    }

    const interval = setInterval(tick, 5000)
    return () => clearInterval(interval)
  }, [isActive, showWittyPhrases, maxLength])

  // Reset when deactivated
  useEffect(() => {
    if (!isActive) {
      setActivePhrase(null)
    }
  }, [isActive])

  return { activeType: activePhrase?.type ?? null, activeText: activePhrase?.text ?? null }
}
