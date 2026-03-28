import { EOL } from "node:os"
import * as prompts from "@clack/prompts"
import { Session } from "liteai/session/index"
import { SessionID } from "liteai/session/schema"
import { Trace } from "liteai/trace/trace"
import type { Argv } from "yargs"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import { cmd } from "./cmd"

export const TraceCommand = cmd({
  command: "trace [sessionID]",
  describe: "export trace data for a session",
  builder: (yargs: Argv) => {
    return yargs
      .positional("sessionID", {
        describe: "session id to export traces for",
        type: "string",
      })
      .option("format", {
        describe: "output format",
        choices: ["json", "md"] as const,
        default: "json" as const,
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined

      if (!sessionID) {
        UI.empty()
        prompts.intro("Export traces", {
          output: process.stderr,
        })

        const sessions = []
        for await (const session of Session.list()) {
          sessions.push(session)
        }

        if (sessions.length === 0) {
          prompts.log.error("No sessions found", {
            output: process.stderr,
          })
          prompts.outro("Done", {
            output: process.stderr,
          })
          return
        }

        sessions.sort((a, b) => b.time.updated - a.time.updated)

        const selected = await prompts.autocomplete({
          message: "Select session",
          maxItems: 10,
          options: sessions.map((session) => ({
            label: session.title,
            value: session.id,
            hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
          })),
          output: process.stderr,
        })

        if (prompts.isCancel(selected)) {
          throw new UI.CancelledError()
        }

        sessionID = selected

        prompts.outro("Exporting traces...", {
          output: process.stderr,
        })
      }

      if (!sessionID) throw new Error("unreachable")
      if (args.format === "md") {
        process.stdout.write(Trace.toMarkdown(sessionID))
      } else {
        process.stdout.write(JSON.stringify(Trace.toJSON(sessionID), null, 2))
      }
      process.stdout.write(EOL)
    })
  },
})
