import { buffer } from "node:stream/consumers"
import { NamedError } from "@liteai/util/error"
import { Log } from "@liteai/util/log"
import { Process } from "@liteai/util/process"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Flag } from "../flag/flag"

declare global {
  const LITEAI_VERSION: string
  const LITEAI_CHANNEL: string
}

export namespace Installation {
  const log = Log.create({ service: "installation" })

  export type Method = Awaited<ReturnType<typeof method>>

  export const Event = {
    Updated: BusEvent.define(
      "installation.updated",
      z.object({
        version: z.string(),
      }),
    ),
    UpdateAvailable: BusEvent.define(
      "installation.update-available",
      z.object({
        version: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      version: z.string(),
      latest: z.string(),
    })
    .meta({
      ref: "InstallationInfo",
    })
  export type Info = z.infer<typeof Info>

  export async function info() {
    return {
      version: VERSION,
      latest: await latest(),
    }
  }

  export function isPreview() {
    return CHANNEL !== "latest"
  }

  export function isLocal() {
    return CHANNEL === "local"
  }

  export async function method() {
    if (isLocal()) return "unknown"
    return "github"
  }

  export const UpgradeFailedError = NamedError.create(
    "UpgradeFailedError",
    z.object({
      stderr: z.string(),
    }),
  )

  export async function upgrade(method: Method, target: string) {
    if (method === "unknown") {
      throw new Error("Cannot upgrade local or unknown installation")
    }

    let result: { code: number | null; stdout: Buffer; stderr: Buffer }

    if (process.platform === "win32") {
      const scriptUrl = "https://github.com/liteaiagent/liteai/releases/latest/download/install.ps1"
      log.info("triggering background update (windows)", { target })

      // PowerShell one-liner to download and execute install.ps1
      const psCommand = `Invoke-WebRequest -Uri ${scriptUrl} -OutFile $env:TEMP\\install.ps1; & $env:TEMP\\install.ps1 -Target 'v${target}'`

      const proc = Process.spawn(
        ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCommand],
        {
          stdout: "pipe",
          stderr: "pipe",
        },
      )
      if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")
      const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
      result = { code, stdout, stderr }
    } else {
      const scriptUrl = "https://github.com/liteaiagent/liteai/releases/latest/download/install"
      log.info("triggering background update (unix)", { target })

      const body = await fetch(scriptUrl).then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.text()
      })
      const proc = Process.spawn(["bash"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          VERSION: target,
        },
      })
      if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")
      proc.stdin.end(body)
      const [code, stdout, stderr] = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
      result = { code, stdout, stderr }
    }

    if (result.code !== 0) {
      const stderr = result.stderr.toString("utf8") || "Unknown error"
      throw new UpgradeFailedError({
        stderr: stderr,
      })
    }

    log.info("upgraded", {
      method,
      target,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    })

    await Process.text([process.execPath, "--version"], { nothrow: true })
  }

  export const VERSION = typeof LITEAI_VERSION === "string" ? LITEAI_VERSION : "local"
  export const CHANNEL = typeof LITEAI_CHANNEL === "string" ? LITEAI_CHANNEL : "local"
  export const USER_AGENT = `liteai/${CHANNEL}/${VERSION}/${Flag.LITEAI_CLIENT}`

  export async function latest() {
    return fetch("https://api.github.com/repos/liteaiagent/liteai/releases/latest")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText)
        return res.json()
      })
      .then((data: { tag_name: string }) => data.tag_name.replace(/^v/, ""))
  }
}
