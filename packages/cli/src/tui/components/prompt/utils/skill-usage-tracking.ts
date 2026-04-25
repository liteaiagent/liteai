import { Config } from "@liteai/core/config/config"
import type { Info } from "@liteai/core/config/schema"

const SKILL_USAGE_DEBOUNCE_MS = 60_000

// Process-lifetime debounce cache — avoids lock + read + parse on debounced calls.
const lastWriteBySkill = new Map<string, number>()

/**
 * Records a skill usage for ranking purposes.
 * Updates both usage count and last used timestamp asynchronously.
 */
export function recordSkillUsage(skillName: string): void {
  const now = Date.now()
  const lastWrite = lastWriteBySkill.get(skillName)

  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return
  }

  lastWriteBySkill.set(skillName, now)

  void (async () => {
    try {
      const config = await Config.getGlobal()
      const existing = config.skillUsage?.[skillName]

      await Config.updateGlobal({
        ...config,
        skillUsage: {
          ...config.skillUsage,
          [skillName]: {
            usageCount: (existing?.usageCount ?? 0) + 1,
            lastUsedAt: now,
          },
        },
      })
    } catch (_error) {
      // Ignore errors reading/writing global config during usage tracking
    }
  })()
}

/**
 * Calculates a usage score for a skill based on frequency and recency.
 * Higher scores indicate more frequently and recently used skills.
 *
 * The score uses exponential decay with a half-life of 7 days,
 * meaning usage from 7 days ago is worth half as much as usage today.
 */
export function getSkillUsageScore(skillName: string, config: Info): number {
  try {
    const usage = config.skillUsage?.[skillName]
    if (!usage) return 0

    // Recency decay: halve score every 7 days
    const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24)
    const recencyFactor = 0.5 ** (daysSinceUse / 7)

    // Minimum recency factor of 0.1 to avoid completely dropping old but heavily used skills
    return usage.usageCount * Math.max(recencyFactor, 0.1)
  } catch {
    return 0
  }
}
