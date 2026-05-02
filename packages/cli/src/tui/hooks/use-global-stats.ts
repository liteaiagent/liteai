import type { Session } from "@liteai/sdk"
import { useEffect, useMemo, useState } from "react"
import { useSDK } from "../context/sdk"

export type DateRange = "7d" | "30d" | "90d" | "all"

export interface GlobalStats {
  loading: boolean
  totalSessions: number
  totalTokens: number
  totalCost: number
  dailyActivity: Map<string, number>
  longestStreak: number
  currentStreak: number
  peakDay: { date: string; count: number } | null
  dateRange: DateRange
}

export function useGlobalStats(range: DateRange): GlobalStats {
  const sdk = useSDK()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    const start = rangeToTimestamp(range)
    sdk.client.project.session
      .list({
        projectID: sdk.projectID,
        start,
        roots: true,
        limit: 1000,
      })
      .then((res) => {
        if (active) {
          setSessions(res.data ?? [])
          setLoading(false)
        }
      })
      .catch(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [sdk, range])

  return useMemo(() => {
    if (loading) {
      return {
        loading: true,
        totalSessions: 0,
        totalTokens: 0,
        totalCost: 0,
        dailyActivity: new Map(),
        longestStreak: 0,
        currentStreak: 0,
        peakDay: null,
        dateRange: range,
      }
    }

    const dailyActivity = new Map<string, number>()
    const totalTokens = 0
    const totalCost = 0

    for (const s of sessions) {
      const day = new Date(s.time.created).toISOString().split("T")[0]
      dailyActivity.set(day, (dailyActivity.get(day) ?? 0) + 1)
      // Token/cost could be extracted from session summary if available in future
    }

    const { longestStreak, currentStreak } = computeStreaks(dailyActivity)
    const peakDay = findPeakDay(dailyActivity)

    return {
      loading: false,
      totalSessions: sessions.length,
      totalTokens,
      totalCost,
      dailyActivity,
      longestStreak,
      currentStreak,
      peakDay,
      dateRange: range,
    }
  }, [sessions, loading, range])
}

function rangeToTimestamp(range: DateRange): number | undefined {
  if (range === "all") return undefined
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90
  return Date.now() - days * 24 * 60 * 60 * 1000
}

function isConsecutive(day1: string, day2: string) {
  const d1 = new Date(day1).getTime()
  const d2 = new Date(day2).getTime()
  // diff is exactly 1 day
  return Math.abs(d2 - d1) === 24 * 60 * 60 * 1000
}

function computeStreaks(daily: Map<string, number>) {
  const days = [...daily.keys()].sort()
  let longestStreak = 0
  let currentStreak = 0
  let streak = 0
  const today = new Date().toISOString().split("T")[0]

  for (let i = 0; i < days.length; i++) {
    if (i === 0 || isConsecutive(days[i - 1], days[i])) {
      streak++
    } else {
      streak = 1
    }
    longestStreak = Math.max(longestStreak, streak)
  }

  const sortedDesc = [...days].reverse()
  currentStreak = 0
  let check = today

  // Current streak might include today or yesterday
  if (sortedDesc[0] === today || isConsecutive(sortedDesc[0], today)) {
    check = sortedDesc[0]
    for (const day of sortedDesc) {
      if (day === check || isConsecutive(day, check)) {
        currentStreak++
        check = day
      } else {
        break
      }
    }
  }

  return { longestStreak, currentStreak }
}

function findPeakDay(daily: Map<string, number>) {
  let peak = null
  let max = 0
  for (const [date, count] of daily.entries()) {
    if (count > max) {
      max = count
      peak = { date, count }
    }
  }
  return peak
}
