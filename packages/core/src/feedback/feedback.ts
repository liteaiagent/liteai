import fs from "node:fs/promises"
import path from "node:path"
import { Log } from "@liteai/util/log"
import z from "zod"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"

const log = Log.create({ service: "feedback" })

export namespace Feedback {
  /** Rating value for a message. */
  export const Rating = z.enum(["good", "bad"])
  export type Rating = z.infer<typeof Rating>

  /** Environment info captured with the feedback. */
  export const Environment = z.object({
    platform: z.string(),
    arch: z.string(),
    version: z.string().optional(),
  })
  export type Environment = z.infer<typeof Environment>

  /** Schema for a feedback submission. */
  export const Submission = z.object({
    timestamp: z.number(),
    description: z.string(),
    sessionID: z.string(),
    transcript: z.array(z.record(z.string(), z.unknown())).optional(),
    environment: Environment,
  })
  export type Submission = z.infer<typeof Submission>

  /** Schema for the response after submitting feedback. */
  export const SubmissionResult = z.object({
    id: z.string(),
    path: z.string(),
  })
  export type SubmissionResult = z.infer<typeof SubmissionResult>

  /** Schema for a rating entry. */
  export const RatingEntry = z.object({
    sessionID: z.string(),
    messageID: z.string(),
    rating: Rating,
    timestamp: z.number(),
  })
  export type RatingEntry = z.infer<typeof RatingEntry>

  /** Schema for a session-level survey response. */
  export const SurveyEntry = z.object({
    sessionID: z.string(),
    response: z.enum(["bad", "fine", "good", "dismissed"]),
    timestamp: z.number(),
  })
  export type SurveyEntry = z.infer<typeof SurveyEntry>

  // ── Persistence ────────────────────────────────────────────────────────

  function feedbackDir(): string {
    return path.join(Global.Path.state, "feedback")
  }

  function ratingsFile(): string {
    return path.join(Global.Path.state, "ratings.json")
  }

  /**
   * Submit a feedback report. Writes a JSON file to the state directory.
   * @returns The generated ID and file path.
   */
  export async function submit(data: Submission): Promise<SubmissionResult> {
    const dir = feedbackDir()
    await Filesystem.write(path.join(dir, ".keep"), "")
    const id = `${data.timestamp}-${Math.random().toString(36).substring(2, 8)}`
    const filePath = path.join(dir, `${id}.json`)
    await Filesystem.writeJson(filePath, data)
    log.info("feedback submitted", { id, path: filePath })
    return { id, path: filePath }
  }

  /**
   * Record a rating for a specific message within a session.
   * Appends to the ratings JSON file as a JSON lines file.
   */
  export async function rate(entry: RatingEntry): Promise<void> {
    const file = ratingsFile()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const line = `${JSON.stringify(entry)}
`
    await fs.appendFile(file, line, "utf-8")
    log.info("rating recorded", { sessionID: entry.sessionID, messageID: entry.messageID, rating: entry.rating })
  }

  /**
   * Record a session-level survey response.
   */
  export async function survey(entry: SurveyEntry): Promise<void> {
    const file = ratingsFile()
    await fs.mkdir(path.dirname(file), { recursive: true })
    const line = `${JSON.stringify({ ...entry, type: "survey" })}
`
    await fs.appendFile(file, line, "utf-8")
    log.info("survey recorded", { sessionID: entry.sessionID, response: entry.response })
  }
}
