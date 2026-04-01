/**
 * Fake LSP client fixture for testing the LSP handler.
 *
 * Spawns `lsp-handler.ts` as a subprocess and connects via JSON-RPC over stdio.
 * The subprocess runs a minimal script that imports and calls startLSPHandler().
 */

// --- JSON-RPC framing helpers ---

export function encode(message: unknown): Buffer {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

export function decodeFrames(buffer: Buffer): { messages: string[]; rest: Buffer } {
  const results: string[] = []
  let buf = buffer
  let idx = buf.indexOf("\r\n\r\n")
  while (idx !== -1) {
    const header = buf.slice(0, idx).toString("utf8")
    const m = /Content-Length:\s*(\d+)/i.exec(header)
    const len = m ? parseInt(m[1], 10) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + len
    if (buf.length < bodyEnd) break
    const body = buf.slice(bodyStart, bodyEnd).toString("utf8")
    results.push(body)
    buf = buf.slice(bodyEnd)
    idx = buf.indexOf("\r\n\r\n")
  }
  return { messages: results, rest: buf }
}
