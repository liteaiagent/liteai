import { Hono } from "hono"
import { streamSSE } from "hono/streaming"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Installation } from "@/installation"
import { Config } from "../../config/config"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { isTelemetryEnabled } from "../../telemetry/instrumentation"
import { lazy } from "../../util/lazy"
import { Log } from "../../util/log"
import { HEARTBEAT_INTERVAL_MS } from "../constants"
import { errors } from "../error"
import { Event } from "../event"

const log = Log.create({ service: "server" })

async function browse(): Promise<string | null> {
  const platform = process.platform
  if (platform === "win32") {
    // Use the COM IFileOpenDialog with FOS_PICKFOLDERS — the same API Electron/VS Code uses.
    // This gives the modern Explorer-style dialog instead of the old tree-style FolderBrowserDialog.
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
class FileOpenDialogCOM { }

public class FolderPicker {
    public static string Show() {
        var dialog = (IFileOpenDialog)new FileOpenDialogCOM();
        try {
            dialog.SetOptions(0x20 | 0x800 | 0x40000); // FOS_PICKFOLDERS | FOS_NOCHANGEDIR | FOS_FORCEFILESYSTEM
            dialog.SetTitle("Select a project folder");
            int hr = dialog.Show(IntPtr.Zero);
            if (hr != 0) return null;
            IShellItem item;
            dialog.GetResult(out item);
            string path;
            item.GetDisplayName(0x80058000, out path);
            Marshal.ReleaseComObject(item);
            return path;
        } catch {
            return null;
        } finally {
            Marshal.ReleaseComObject(dialog);
        }
    }
}

[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IFileOpenDialog {
    [PreserveSig] int Show(IntPtr hwndOwner);
    void SetFileTypes(uint cFileTypes, IntPtr rgFilterSpec);
    void SetFileTypeIndex(uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise(IntPtr pfde, out uint pdwCookie);
    void Unadvise(uint dwCookie);
    void SetOptions(uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IShellItem {
    void BindToHandler(IntPtr pbc, [MarshalAs(UnmanagedType.LPStruct)] Guid bhid, [MarshalAs(UnmanagedType.LPStruct)] Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
}
'@ -ReferencedAssemblies System.Runtime.InteropServices
Write-Output ([FolderPicker]::Show())
`
    for (const shell of ["pwsh", "powershell"]) {
      try {
        const proc = Bun.spawn([shell, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script], {
          stdout: "pipe",
          stderr: "pipe",
        })
        const text = await new Response(proc.stdout).text()
        const code = await proc.exited
        if (code === 0) {
          const trimmed = text.trim()
          return trimmed || null
        }
      } catch (e) {
        log.debug("folder picker shell failed, trying next", { shell, error: e })
      }
    }
    return null
  }
  if (platform === "darwin") {
    const proc = Bun.spawn(["osascript", "-e", 'POSIX path of (choose folder with prompt "Select a project folder")'], {
      stdout: "pipe",
      stderr: "pipe",
    })
    const text = await new Response(proc.stdout).text()
    const code = await proc.exited
    if (code !== 0) return null
    const trimmed = text.trim().replace(/\/$/, "")
    return trimmed || null
  }
  // Linux: try zenity first, then kdialog
  for (const cmd of [
    ["zenity", "--file-selection", "--directory", "--title=Select a project folder"],
    ["kdialog", "--getexistingdirectory", "."],
  ]) {
    try {
      const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" })
      const text = await new Response(proc.stdout).text()
      const code = await proc.exited
      if (code === 0) {
        const trimmed = text.trim()
        if (trimmed) return trimmed
      }
    } catch (e) {
      log.debug("folder picker command failed, trying next", { cmd: cmd[0], error: e })
    }
  }
  return null
}

export const GlobalDisposedEvent = BusEvent.define("global.disposed", z.object({}))

export const GlobalRoutes = lazy(() =>
  new Hono()
    .get(
      "/health",
      describeRoute({
        summary: "Get health",
        description: "Get health information about the LiteAI server.",
        operationId: "health",
        responses: {
          200: {
            description: "Health information",
            content: {
              "application/json": {
                schema: resolver(z.object({ healthy: z.literal(true), version: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({ healthy: true, version: Installation.VERSION })
      },
    )
    .get(
      "/event",
      describeRoute({
        summary: "Get global events",
        description: "Subscribe to global events from the LiteAI system using server-sent events.",
        operationId: "event.subscribe",
        responses: {
          200: {
            description: "Event stream",
            content: {
              "text/event-stream": {
                schema: resolver(
                  z
                    .object({
                      directory: z.string(),
                      payload: BusEvent.payloads(),
                    })
                    .meta({
                      ref: "GlobalEvent",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        log.info("global event connected")
        c.header("X-Accel-Buffering", "no")
        c.header("X-Content-Type-Options", "nosniff")
        return streamSSE(c, async (stream) => {
          stream.writeSSE({
            data: JSON.stringify({
              payload: {
                type: Event.Connected.type,
                properties: {},
              },
            }),
          })
          async function handler(event: { directory?: string; payload: unknown }) {
            try {
              await stream.writeSSE({
                data: JSON.stringify(event),
              })
            } catch {
              // Client disconnected (EPIPE) — clean up
              GlobalBus.off("event", handler)
              return
            }
          }
          GlobalBus.on("event", handler)

          // Send heartbeat every 10s to prevent stalled proxy streams.
          const heartbeat = setInterval(() => {
            try {
              stream.writeSSE({
                data: JSON.stringify({
                  payload: {
                    type: Event.Heartbeat.type,
                    properties: {},
                  },
                }),
              })
            } catch {
              // Client disconnected — heartbeat can stop silently
              clearInterval(heartbeat)
            }
          }, HEARTBEAT_INTERVAL_MS)

          await new Promise<void>((resolve) => {
            stream.onAbort(() => {
              clearInterval(heartbeat)
              GlobalBus.off("event", handler)
              resolve()
              log.info("global event disconnected")
            })
          })
        })
      },
    )
    .get(
      "/config",
      describeRoute({
        summary: "Get global configuration",
        description: "Retrieve the current global LiteAI configuration settings and preferences.",
        operationId: "config.get",
        responses: {
          200: {
            description: "Get global config info",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Config.getGlobal())
      },
    )
    .patch(
      "/config",
      describeRoute({
        summary: "Update global configuration",
        description: "Update global LiteAI configuration settings and preferences.",
        operationId: "config.update",
        responses: {
          200: {
            description: "Successfully updated global config",
            content: {
              "application/json": {
                schema: resolver(Config.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Config.Info),
      async (c) => {
        const config = c.req.valid("json")
        const next = await Config.updateGlobal(config)
        return c.json(next)
      },
    )
    .post(
      "/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose all LiteAI instances, releasing all resources.",
        operationId: "dispose",
        responses: {
          200: {
            description: "Global disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.disposeAll()
        GlobalBus.emit("event", {
          directory: "global",
          payload: {
            type: GlobalDisposedEvent.type,
            properties: {},
          },
        })
        return c.json(true)
      },
    )
    .post(
      "/browse",
      describeRoute({
        summary: "Browse for folder",
        description: "Open a native OS folder picker dialog and return the selected path.",
        operationId: "browse",
        responses: {
          200: {
            description: "Selected folder path or null if cancelled",
            content: {
              "application/json": {
                schema: resolver(z.object({ path: z.string().nullable() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await browse()
        return c.json({ path: result })
      },
    )
    .get(
      "/log",
      describeRoute({
        summary: "Get combined log contents",
        description: "Read and merge all channel and main log files into a single sorted stream.",
        operationId: "log",
        responses: {
          200: {
            description: "Combined log lines sorted by timestamp, plus discovered services",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    lines: z.array(z.string()),
                    services: z.array(z.string()),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const fs = await import("node:fs/promises")
        const path = await import("node:path")
        const all: string[] = []

        // Read channel log files
        for (const ch of Log.CHANNELS) {
          const file = path.join(Global.Path.log, `${ch}.log`)
          const text = await fs.readFile(file, "utf-8").catch(() => "")
          if (text) all.push(...text.split("\n").filter(Boolean))
        }

        // Read current main log
        const main = Log.file()
        if (main) {
          const text = await fs.readFile(main, "utf-8").catch(() => "")
          if (text) all.push(...text.split("\n").filter(Boolean))
        }

        // Sort by timestamp (format: LEVEL  YYYY-MM-DDTHH:MM:SS)
        const ts = (line: string) => {
          const m = line.match(/^\w+\s+(\S+)/)
          return m?.[1] ?? ""
        }
        all.sort((a, b) => ts(a).localeCompare(ts(b)))

        // Extract unique services
        const services = new Set<string>()
        for (const line of all) {
          const m = line.match(/service=(\S+)/)
          if (m) services.add(m[1])
        }

        return c.json({ lines: all, services: [...services].sort() })
      },
    )
    .post(
      "/log",
      describeRoute({
        summary: "Write log",
        description: "Write a log entry to the server logs with specified level and metadata.",
        operationId: "log.write",
        responses: {
          200: {
            description: "Log entry written successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator(
        "json",
        z.object({
          service: z.string().meta({ description: "Service name for the log entry" }),
          level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
          message: z.string().meta({ description: "Log message" }),
          extra: z
            .record(z.string(), z.any())
            .optional()
            .meta({ description: "Additional metadata for the log entry" }),
        }),
      ),
      async (c) => {
        const { service, level, message, extra } = c.req.valid("json")
        const logger = Log.create({ service })

        switch (level) {
          case "debug":
            logger.debug(message, extra)
            break
          case "info":
            logger.info(message, extra)
            break
          case "error":
            logger.error(message, extra)
            break
          case "warn":
            logger.warn(message, extra)
            break
        }

        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get global paths",
        description: "Retrieve global path information for the LiteAI installation (home, state, config).",
        operationId: "path",
        responses: {
          200: {
            description: "Global paths",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                    })
                    .meta({ ref: "GlobalPath" }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
        })
      },
    )
    // ── Telemetry settings ────────────────────────────────────────────────────
    .get(
      "/telemetry",
      describeRoute({
        summary: "Get telemetry settings",
        description:
          "Retrieve the current telemetry enabled/disabled status. " +
          "Telemetry is enabled by default; clients can opt out via PATCH /telemetry.",
        operationId: "telemetry.get",
        responses: {
          200: {
            description: "Current telemetry status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.boolean().describe("Whether telemetry is currently active"),
                    source: z
                      .enum(["env", "config", "default"])
                      .describe("Where the setting was read from"),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const envDisabled =
          process.env.LITEAI_TELEMETRY_DISABLED === "1" ||
          process.env.LITEAI_TELEMETRY_DISABLED === "true" ||
          process.env.LITEAI_ENABLE_TELEMETRY === "0" ||
          process.env.LITEAI_ENABLE_TELEMETRY === "false"

        const hasEnvOverride =
          process.env.LITEAI_TELEMETRY_DISABLED !== undefined ||
          process.env.LITEAI_ENABLE_TELEMETRY !== undefined

        if (hasEnvOverride) {
          return c.json({ enabled: !envDisabled, source: "env" as const })
        }

        const globalConfig = await Config.getGlobal()
        if (globalConfig.telemetry?.disabled !== undefined) {
          return c.json({ enabled: !globalConfig.telemetry.disabled, source: "config" as const })
        }

        return c.json({ enabled: isTelemetryEnabled(), source: "default" as const })
      },
    )
    .patch(
      "/telemetry",
      describeRoute({
        summary: "Update telemetry settings",
        description:
          "Enable or disable telemetry. The setting is persisted to the global config file " +
          "and takes effect immediately. Note: if LITEAI_TELEMETRY_DISABLED is set as an " +
          "environment variable, it takes precedence over this setting.",
        operationId: "telemetry.update",
        responses: {
          200: {
            description: "Updated telemetry status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    enabled: z.boolean(),
                    source: z.enum(["env", "config", "default"]),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          enabled: z.boolean().describe("Set to true to enable telemetry, false to disable (opt-out)"),
        }),
      ),
      async (c) => {
        const { enabled } = c.req.valid("json")

        // Persist to global config so it survives restarts
        await Config.updateGlobal({ telemetry: { disabled: !enabled } })

        // Apply immediately for the current process lifetime
        if (!enabled) {
          process.env.LITEAI_TELEMETRY_DISABLED = "1"
        } else {
          delete process.env.LITEAI_TELEMETRY_DISABLED
          // Also clear legacy opt-in var if it was blocking telemetry
          if (process.env.LITEAI_ENABLE_TELEMETRY === "0" || process.env.LITEAI_ENABLE_TELEMETRY === "false") {
            delete process.env.LITEAI_ENABLE_TELEMETRY
          }
        }

        log.info("telemetry setting updated", { enabled })

        return c.json({ enabled, source: "config" as const })
      },
    ),
)
