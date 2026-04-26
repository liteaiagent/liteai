import type { Readable } from "node:stream"
import { Fs as NativeFs } from "@liteai/util/fs"
import { Capabilities } from "../capabilities/context"

export namespace Filesystem {
  // Fast sync version for metadata checks
  export async function exists(p: string): Promise<boolean> {
    if (Capabilities.ready() && Capabilities.isHosted()) {
      return Capabilities.get().fs.exists(p)
    }
    return NativeFs.exists(p)
  }

  export const isDir = NativeFs.isDir
  export const stat = NativeFs.stat
  export const size = NativeFs.size

  export async function readText(p: string): Promise<string> {
    if (Capabilities.ready() && Capabilities.isHosted()) {
      return Capabilities.get().fs.readFile(p)
    }
    return NativeFs.readText(p)
  }

  export async function readJson<T = unknown>(p: string): Promise<T> {
    return JSON.parse(await readText(p))
  }

  export async function readBytes(p: string): Promise<Buffer> {
    if (Capabilities.ready() && Capabilities.isHosted()) {
      return Capabilities.get().fs.readFileBytes(p)
    }
    return NativeFs.readBytes(p)
  }

  export async function readArrayBuffer(p: string): Promise<ArrayBuffer> {
    const buf = await readBytes(p)
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  export async function write(p: string, content: string | Buffer | Uint8Array, mode?: number): Promise<void> {
    if (Capabilities.ready() && Capabilities.isHosted() && !mode) {
      return Capabilities.get().fs.writeFile(p, content)
    }
    return NativeFs.write(p, content, mode)
  }

  export async function writeJson(p: string, data: unknown, mode?: number): Promise<void> {
    return write(p, JSON.stringify(data, null, 2), mode)
  }

  export async function writeStream(
    p: string,
    stream: ReadableStream<Uint8Array> | Readable,
    mode?: number,
  ): Promise<void> {
    // Hosted write stream not supported yet, fallback to Native
    return NativeFs.writeStream(p, stream, mode)
  }

  export const mimeType = NativeFs.mimeType
  export const normalizePath = NativeFs.normalizePath
  export const resolve = NativeFs.resolve
  export const windowsPath = NativeFs.windowsPath
  export const overlaps = NativeFs.overlaps
  export const contains = NativeFs.contains

  export async function findUp(target: string, start: string, stop?: string) {
    let current = start
    const result = []
    while (true) {
      const search = NativeFs.resolve(NativeFs.windowsPath(`${current}/${target}`))
      if (await exists(search)) result.push(search)
      if (stop === current) break
      const parent = NativeFs.resolve(NativeFs.windowsPath(`${current}/..`))
      if (parent === current) break
      current = parent
    }
    return result
  }

  export async function* up(options: { targets: string[]; start: string; stop?: string }) {
    const { targets, start, stop } = options
    let current = start
    while (true) {
      for (const target of targets) {
        const search = NativeFs.resolve(NativeFs.windowsPath(`${current}/${target}`))
        if (await exists(search)) yield search
      }
      if (stop === current) break
      const parent = NativeFs.resolve(NativeFs.windowsPath(`${current}/..`))
      if (parent === current) break
      current = parent
    }
  }

  export const globUp = NativeFs.globUp
}
