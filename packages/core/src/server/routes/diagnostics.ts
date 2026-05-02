import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "../../config/config"
import { MCP } from "../../mcp"
import { Instance } from "../../project/instance"
import { Provider } from "../../provider/provider"
import { Database } from "../../storage/db"
import { lazy } from "../../util/lazy"

const DiagnosticResult = z.object({
  name: z.string(),
  status: z.enum(["ok", "warn", "error"]),
  message: z.string(),
  details: z.string().optional(),
})

type DiagResult = z.infer<typeof DiagnosticResult>

export const DiagnosticRoutes = lazy(() =>
  new Hono().get(
    "/",
    describeRoute({
      summary: "Run diagnostics",
      description: "Run system health checks and return diagnostic results.",
      operationId: "project.diagnostics",
      responses: {
        200: {
          description: "Diagnostic results",
          content: { "application/json": { schema: resolver(DiagnosticResult.array()) } },
        },
      },
    }),
    async (c) => {
      const checks = await runDiagnostics()
      return c.json(checks)
    },
  ),
)

async function runDiagnostics(): Promise<DiagResult[]> {
  const results: DiagResult[] = []

  // 1. Runtime
  results.push({
    name: "Runtime",
    status: "ok",
    message: `Bun ${Bun.version}`,
  })

  // 2. Ripgrep
  try {
    const proc = Bun.spawn(["rg", "--version"], { stdout: "pipe" })
    const output = await new Response(proc.stdout).text()
    results.push({ name: "Ripgrep", status: "ok", message: output.trim().split("\n")[0] })
  } catch {
    results.push({ name: "Ripgrep", status: "error", message: "Not found in PATH" })
  }

  // 3. Git
  try {
    const proc = Bun.spawn(["git", "--version"], { stdout: "pipe" })
    const output = await new Response(proc.stdout).text()
    results.push({ name: "Git", status: "ok", message: output.trim().split("\n")[0] })
  } catch {
    results.push({ name: "Git", status: "warn", message: "Not found in PATH" })
  }

  // 4. Project directory
  results.push({
    name: "Project",
    status: "ok",
    message: Instance.directory,
  })

  // 5. MCP servers
  try {
    const mcpStatus = await MCP.status()
    const entries = Object.entries(mcpStatus)
    const connected = entries.filter(([, s]) => s.status === "connected").length
    const failed = entries.filter(([, s]) => s.status === "failed").length
    const needsAuth = entries.filter(
      ([, s]) => s.status === "needs_auth" || s.status === "needs_client_registration",
    ).length

    results.push({
      name: "MCP Servers",
      status: failed > 0 ? "warn" : "ok",
      message: `${entries.length} configured, ${connected} connected${failed > 0 ? `, ${failed} failed` : ""}${needsAuth > 0 ? `, ${needsAuth} needs auth` : ""}`,
      details:
        failed > 0
          ? entries
              .filter(([, s]) => s.status === "failed")
              .map(([name, s]) => `${name}: ${s.status === "failed" ? s.error : s.status}`)
              .join("; ")
          : undefined,
    })
  } catch (e) {
    results.push({
      name: "MCP Servers",
      status: "error",
      message: `Failed to query MCP status: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // 6. Configuration
  try {
    const config = await Config.get()
    const hasModel = Boolean(config.model)
    const hasMcp = Object.keys(config.mcpServers ?? {}).length > 0
    results.push({
      name: "Configuration",
      status: "ok",
      message: `model: ${config.model ?? "default"}${hasMcp ? ", MCP configured" : ""}`,
      details: hasModel ? undefined : "No default model set — using provider defaults",
    })
  } catch (e) {
    results.push({
      name: "Configuration",
      status: "error",
      message: `Config load failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // 7. SQLite database
  try {
    const sqlite = Database.getRawSQLite()
    const integrityResult = sqlite.query("PRAGMA integrity_check(1)").get() as { integrity_check: string } | null
    const isOk = integrityResult?.integrity_check === "ok"
    results.push({
      name: "Database",
      status: isOk ? "ok" : "error",
      message: isOk ? `SQLite OK — ${Database.Path}` : `Integrity check failed: ${integrityResult?.integrity_check}`,
    })
  } catch (e) {
    results.push({
      name: "Database",
      status: "error",
      message: `Database check failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  // 8. Available providers
  try {
    const providers = await Provider.list()
    const providerNames = Object.keys(providers)
    const modelCount = Object.values(providers).reduce((acc, p) => acc + Object.keys(p.models).length, 0)
    results.push({
      name: "Providers",
      status: providerNames.length > 0 ? "ok" : "warn",
      message: `${providerNames.length} providers, ${modelCount} models`,
      details: providerNames.join(", "),
    })
  } catch (e) {
    results.push({
      name: "Providers",
      status: "error",
      message: `Provider list failed: ${e instanceof Error ? e.message : String(e)}`,
    })
  }

  return results
}
