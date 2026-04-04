/**
 * Antigravity LSP — Process Detection
 *
 * Finds running `language_server` processes, extracts all command-line args,
 * AND discovers all TCP listening ports via OS-level queries.
 */

import { exec } from "node:child_process"
import { promisify } from "node:util"

const execAsync = promisify(exec)

export interface DetectedServer {
  pid: number
  ppid: number | null
  /** All extracted key-value args from the command line */
  args: Record<string, string>
  /** All TCP ports this process is listening on (from OS) */
  listeningPorts: number[]
  rawCmdLine: string
}

// ── Windows ──────────────────────────────────────────────────────────

const PS_COMMAND = [
  `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;`,
  `$n = 'language_server_windows_x64.exe';`,
  `$f = 'name=''' + $n + '''';`,
  `$p = Get-CimInstance Win32_Process -Filter $f -ErrorAction SilentlyContinue;`,
  `if ($p) { @($p) | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress } else { '[]' }`,
].join(" ")

function parseWindowsOutput(stdout: string): Array<{ pid: number; ppid: number | null; args: Record<string, string>; rawCmdLine: string }> {
  const trimmed = stdout.trim()
  if (!trimmed || trimmed === "[]") return []

  try {
    const raw = JSON.parse(trimmed)
    const list = Array.isArray(raw) ? raw : [raw]
    return list.flatMap((p: any) => {
      const cmdline: string = p.CommandLine ?? ""
      if (!cmdline) return []
      return [{
        pid: Number(p.ProcessId),
        ppid: p.ParentProcessId != null ? Number(p.ParentProcessId) : null,
        args: parseAllArgs(cmdline),
        rawCmdLine: cmdline,
      }]
    })
  } catch {
    return []
  }
}

// ── Unix ─────────────────────────────────────────────────────────────

function unixProcessName(): string {
  const arch = process.arch
  if (process.platform === "darwin") {
    return `language_server_macos${arch === "arm64" ? "_arm" : ""}`
  }
  return `language_server_linux${arch === "arm64" ? "_arm" : "_x64"}`
}

function parseUnixOutput(stdout: string): Array<{ pid: number; ppid: number | null; args: Record<string, string>; rawCmdLine: string }> {
  return stdout
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const m = line.trim().match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
      if (!m || !m[1] || !m[2] || !m[3]) return []
      return [{
        pid: Number(m[1]),
        ppid: Number(m[2]),
        args: parseAllArgs(m[3]),
        rawCmdLine: m[3],
      }]
    })
}

// ── Arg parser: extract ALL --key value pairs ────────────────────────

function parseAllArgs(cmdline: string): Record<string, string> {
  const result: Record<string, string> = {}
  // Handle --key=value
  const eqRe = /--([\w]+)=([^\s]+)/g
  let match: RegExpExecArray | null
  while ((match = eqRe.exec(cmdline)) !== null) {
    if (match[1] && match[2]) {
      result[match[1]] = match[2]
    }
  }
  // Handle --key value (space-separated)
  const spRe = /--([\w]+)\s+([^\s-][^\s]*)/g
  while ((match = spRe.exec(cmdline)) !== null) {
    if (match[1] && match[2] && !(match[1] in result)) {
      result[match[1]] = match[2]
    }
  }
  return result
}

// ── OS-level port discovery ──────────────────────────────────────────

async function getListeningPorts(pid: number): Promise<number[]> {
  try {
    if (process.platform === "win32") {
      // PowerShell: Get-NetTCPConnection — same as the antigravity panel
      const cmd = `powershell -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p = Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort; if ($p) { $p | Sort-Object -Unique }"`
      const { stdout } = await execAsync(cmd, { timeout: 8_000 })
      return stdout
        .trim()
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^\d+$/.test(l))
        .map(Number)
        .filter((p) => p > 0 && p <= 65535)
    }

    // Unix: lsof
    const cmd = `lsof -nP -a -iTCP -sTCP:LISTEN -p ${pid} 2>/dev/null`
    const { stdout } = await execAsync(cmd, { timeout: 5_000 })
    const ports: number[] = []
    for (const line of stdout.split("\n")) {
      const m = line.match(/(?:TCP|UDP)\s+(?:\*|[\d.]+|\[[\da-f:]+\]):(\d+)\s+\(LISTEN\)/i)
      if (m?.[1]) {
        const port = Number(m[1])
        if (!ports.includes(port)) ports.push(port)
      }
    }
    return ports.sort((a, b) => a - b)
  } catch {
    return []
  }
}

// ── Public API ───────────────────────────────────────────────────────

export async function detectServers(): Promise<DetectedServer[]> {
  let processes: Array<{ pid: number; ppid: number | null; args: Record<string, string>; rawCmdLine: string }>

  if (process.platform === "win32") {
    const { stdout } = await execAsync(
      `powershell -NoProfile -Command "${PS_COMMAND}"`,
      { timeout: 10_000 },
    )
    processes = parseWindowsOutput(stdout)
  } else {
    const name = unixProcessName()
    const first = name.charAt(0)
    const { stdout } = await execAsync(
      `ps -A -ww -o pid,ppid,args | grep "[${first}]${name.slice(1)}"`,
      { timeout: 5_000 },
    )
    processes = parseUnixOutput(stdout)
  }

  // Enrich with OS-level port discovery
  const servers: DetectedServer[] = []
  for (const p of processes) {
    const listeningPorts = await getListeningPorts(p.pid)
    servers.push({ ...p, listeningPorts })
  }
  return servers
}

// ── Standalone run ───────────────────────────────────────────────────

if (import.meta.main) {
  console.log("🔍 Detecting Antigravity Language Server processes...\n")
  console.log(`   Platform: ${process.platform} (${process.arch})`)

  try {
    const servers = await detectServers()
    if (servers.length === 0) {
      console.log("\n⚠️  No language_server processes found.")
    } else {
      console.log(`\n✅ Found ${servers.length} server(s):\n`)
      for (const s of servers) {
        console.log(`   PID:  ${s.pid}`)
        console.log(`   PPID: ${s.ppid ?? "N/A"}`)
        console.log(`   Args:`)
        for (const [k, v] of Object.entries(s.args)) {
          console.log(`     --${k} = ${v}`)
        }
        console.log(`   Listening Ports (OS): ${s.listeningPorts.join(", ") || "none"}`)
        console.log()
      }
    }
  } catch (e) {
    console.error("❌ Detection failed:", e)
  }
}
