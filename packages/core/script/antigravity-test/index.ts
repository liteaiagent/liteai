#!/usr/bin/env bun
/**
 * Antigravity LSP — Integration Test Runner
 *
 * Replicates the exact flow used by the antigravity-panel extension:
 *   1. Find language_server processes via CIM/ps
 *   2. Extract --csrf_token from command line
 *   3. Discover ALL listening ports via OS tools (Get-NetTCPConnection)
 *   4. Try csrf_token against each port until one responds 200
 *   5. Fetch quota data from the working port
 */

import { detectServers } from "./detect"
import { verifyGateway } from "./gateway"
import { fetchQuota } from "./quota"

const DIVIDER = "─".repeat(60)

function header(title: string) {
  console.log(`\n${DIVIDER}`)
  console.log(`  ${title}`)
  console.log(DIVIDER)
}

// ═════════════════════════════════════════════════════════════════════
//  PHASE 1: Process Detection + OS Port Discovery
// ═════════════════════════════════════════════════════════════════════

header("Phase 1: Process Detection + Port Discovery")

console.log(`   Platform: ${process.platform} (${process.arch})`)
console.log(`   Scanning for language_server processes...\n`)

const servers = await detectServers()

if (servers.length === 0) {
  console.error("   ❌ No language_server processes found.")
  process.exit(1)
}

// for (const s of servers) {
//   console.log(`   ┌─ PID: ${s.pid} (PPID: ${s.ppid ?? "N/A"})`)
//   console.log(`   │  Command-line args:`)
//   for (const [k, v] of Object.entries(s.args)) {
//     console.log(`   │    --${k} = ${v}`)
//   }
//   console.log(`   │  OS listening ports: [${s.listeningPorts.join(", ")}]`)
//   console.log(`   └─`)
//   console.log()
// }

// ═════════════════════════════════════════════════════════════════════
//  PHASE 2: Try csrf_token against ALL OS-discovered ports
//           (this is exactly what the antigravity-panel does)
// ═════════════════════════════════════════════════════════════════════

header("Phase 2: Gateway Verification")

let workingPort = 0
let workingToken = ""
let workingProtocol: "https" | "http" = "http"

for (const s of servers) {
  const csrfToken = s.args.csrf_token
  if (!csrfToken) {
    console.log(`   PID ${s.pid}: no --csrf_token found, skipping.`)
    continue
  }

  // Collect all candidate ports: OS-discovered + extension_server_port
  const extPort = Number(s.args.extension_server_port) || 0
  const allPorts = [...s.listeningPorts]
  if (extPort > 0 && !allPorts.includes(extPort)) {
    allPorts.unshift(extPort) // try cmdline port first
  }

  console.log(`\n   PID ${s.pid}: trying csrf_token against ${allPorts.length} port(s)...`)
  console.log(`   Token: ${csrfToken.substring(0, 12)}...`)

  for (const port of allPorts) {
    process.stdout.write(`     port ${port} → `)
    const result = await verifyGateway("127.0.0.1", port, csrfToken)

    if (result.success) {
      console.log(`✅ ${result.statusCode} (${result.protocol.toUpperCase()}, ${result.latencyMs}ms)`)
      workingPort = port
      workingToken = csrfToken
      workingProtocol = result.protocol
      break
    } else {
      console.log(`❌ ${result.statusCode}${result.error ? ` (${result.error.substring(0, 60)})` : ""}`)
    }
  }

  if (workingPort) break
}

if (!workingPort) {
  console.error("\n   ❌ No working port found!")
  console.error("   The language_server is running but no port accepted our csrf_token.")
  process.exit(1)
}

console.log(`\n   → Working: 127.0.0.1:${workingPort} (${workingProtocol.toUpperCase()})`)

// ═════════════════════════════════════════════════════════════════════
//  PHASE 3: Full Quota Fetch
// ═════════════════════════════════════════════════════════════════════

header("Phase 3: Quota & User Status")

try {
  const quota = await fetchQuota(workingProtocol, "127.0.0.1", workingPort, workingToken)

  console.log("\n   👤 User Info:")
  console.log(`      Name:  ${quota.user.name ?? "N/A"}`)
  console.log(`      Email: ${quota.user.email ?? "N/A"}`)
  console.log(`      Tier:  ${quota.user.tier ?? "N/A"}`)
  console.log(`      Plan:  ${quota.user.plan ?? "N/A"}`)

  console.log("\n   💰 Credits:")
  if (quota.credits.prompt) {
    const c = quota.credits.prompt
    console.log(`      Prompt: ${c.available}/${c.monthly} (${c.pct}% remaining)`)
  } else {
    console.log("      Prompt: N/A")
  }
  if (quota.credits.flow) {
    const c = quota.credits.flow
    console.log(`      Flow:   ${c.available}/${c.monthly} (${c.pct}% remaining)`)
  } else {
    console.log("      Flow:   N/A")
  }

  console.log(`\n   🤖 Models (${quota.models.length}):`)
  if (quota.models.length === 0) {
    console.log("      No model quota data available.")
  } else {
    const maxLabel = Math.max(...quota.models.map((m) => m.label.length), 5)
    for (const m of quota.models) {
      const bar = m.exhausted ? "🔴" : m.remainingPct < 20 ? "🟡" : "🟢"
      console.log(
        `      ${bar} ${m.label.padEnd(maxLabel)} | ${String(m.remainingPct).padStart(3)}% | Resets: ${m.resetsIn} | ${m.modelId}`,
      )
    }
  }

  // console.log(`\n${DIVIDER}`)
  // console.log("  Raw Server Response")
  // console.log(DIVIDER)
  // console.log(JSON.stringify(quota.raw, null, 2))
} catch (e) {
  console.error("   ❌ Quota fetch failed:", e)
  process.exit(1)
}

// header("All Tests Passed ✅")
// console.log(`   Server: 127.0.0.1:${workingPort} (${workingProtocol.toUpperCase()})`)
// console.log()

process.exit(0)
