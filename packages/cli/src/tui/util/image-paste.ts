/**
 * Platform-specific clipboard image reading and image file path detection.
 * Adapted port from MVP `utils/imagePaste.ts`.
 *
 * Key adaptations:
 * - Removed `feature('NATIVE_CLIPBOARD_IMAGE')` + `image-processor-napi` (MVP-only native module)
 * - Removed `getFeatureValue_CACHED_MAY_BE_STALE` (GrowthBook)
 * - Replaced `execa` with `node:child_process.execFile`
 * - Replaced `getFsImplementation().readFileBytesSync` with `node:fs.readFileSync`
 * - Image resizing deferred — returns raw buffer as base64 (sharp integration deferred)
 * - Replaced `logError` with `Log.Default.error`
 */

import { execFile } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { basename, extname, isAbsolute, join } from "node:path"
import { Log } from "@liteai/util/log"

// ─── Types ───────────────────────────────────────────────────────────────────

export type ImageDimensions = {
  readonly originalWidth?: number
  readonly originalHeight?: number
  readonly displayWidth?: number
  readonly displayHeight?: number
}

export type ImageWithDimensions = {
  readonly base64: string
  readonly mediaType: string
  readonly dimensions?: ImageDimensions
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Threshold in characters for when to consider text a "large paste" */
export const PASTE_THRESHOLD = 800

/** Regex for supported image file extensions */
const IMAGE_EXTENSION_REGEX = /\.(png|jpe?g|gif|webp)$/i

type SupportedPlatform = "darwin" | "linux" | "win32"

// ─── Direct execution helpers ────────────────────────────────────────────────

function execDirect(
  file: string,
  args: string[],
  options: { maxBuffer?: number } = {},
): Promise<{ exitCode: number; stdout: string; stdoutBuffer?: Buffer }> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: "buffer", maxBuffer: options.maxBuffer ?? 10 * 1024 * 1024 },
      (error, stdout, _stderr) => {
        resolve({
          exitCode: error ? (error.code ? 1 : 1) : 0,
          stdout: stdout ? stdout.toString("utf-8") : "",
          stdoutBuffer: stdout || undefined,
        })
      },
    )
  })
}

function getScreenshotPath(): string {
  const platform = process.platform
  const baseTmpDir = process.env.LITEAI_TMPDIR ?? (platform === "win32" ? (process.env.TEMP ?? "C:\\Temp") : "/tmp")
  return join(baseTmpDir, "liteai_cli_latest_screenshot.png")
}

async function checkImageDirect(): Promise<boolean> {
  const platform = process.platform
  if (platform === "darwin") {
    const res = await execDirect("osascript", ["-e", "the clipboard as «class PNGf»"])
    return res.exitCode === 0
  }
  if (platform === "win32") {
    const res = await execDirect("powershell", ["-NoProfile", "-Command", "(Get-Clipboard -Format Image) -ne $null"])
    return res.exitCode === 0 && res.stdout.trim().toLowerCase() === "true"
  }
  // linux: try xclip targets then wl-paste list
  const xclipTargets = await execDirect("xclip", ["-selection", "clipboard", "-t", "TARGETS", "-o"])
  if (xclipTargets.exitCode === 0 && /image\/(png|jpeg|jpg|gif|webp|bmp)/i.test(xclipTargets.stdout)) {
    return true
  }
  const wlPasteTargets = await execDirect("wl-paste", ["-l"])
  return wlPasteTargets.exitCode === 0 && /image\/(png|jpeg|jpg|gif|webp|bmp)/i.test(wlPasteTargets.stdout)
}

async function saveImageDirect(screenshotPath: string): Promise<boolean> {
  const platform = process.platform
  if (platform === "darwin") {
    const res = await execDirect("osascript", [
      "-e",
      "set png_data to (the clipboard as «class PNGf»)",
      "-e",
      `set fp to open for access POSIX file "${screenshotPath}" with write permission`,
      "-e",
      "write png_data to fp",
      "-e",
      "close access fp",
    ])
    return res.exitCode === 0
  }
  if (platform === "win32") {
    const res = await execDirect("powershell", [
      "-NoProfile",
      "-Command",
      `$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${screenshotPath.replace(/\\/g, "\\\\")}', [System.Drawing.Imaging.ImageFormat]::Png) }`,
    ])
    return res.exitCode === 0
  }
  // linux
  let res = await execDirect("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"])
  if (res.exitCode === 0 && res.stdoutBuffer && res.stdoutBuffer.length > 0) {
    writeFileSync(screenshotPath, res.stdoutBuffer)
    return true
  }
  res = await execDirect("wl-paste", ["--type", "image/png"])
  if (res.exitCode === 0 && res.stdoutBuffer && res.stdoutBuffer.length > 0) {
    writeFileSync(screenshotPath, res.stdoutBuffer)
    return true
  }
  res = await execDirect("xclip", ["-selection", "clipboard", "-t", "image/bmp", "-o"])
  if (res.exitCode === 0 && res.stdoutBuffer && res.stdoutBuffer.length > 0) {
    writeFileSync(screenshotPath, res.stdoutBuffer)
    return true
  }
  res = await execDirect("wl-paste", ["--type", "image/bmp"])
  if (res.exitCode === 0 && res.stdoutBuffer && res.stdoutBuffer.length > 0) {
    writeFileSync(screenshotPath, res.stdoutBuffer)
    return true
  }
  return false
}

async function getImagePathFromClipboardDirect(): Promise<string | null> {
  const platform = process.platform
  if (platform === "darwin") {
    const res = await execDirect("osascript", ["-e", "get POSIX path of (the clipboard as «class furl»)"])
    return res.exitCode === 0 && res.stdout ? res.stdout.trim() : null
  }
  if (platform === "win32") {
    const res = await execDirect("powershell", ["-NoProfile", "-Command", "Get-Clipboard"])
    return res.exitCode === 0 && res.stdout ? res.stdout.trim() : null
  }
  // linux
  const xclipRes = await execDirect("xclip", ["-selection", "clipboard", "-t", "text/plain", "-o"])
  if (xclipRes.exitCode === 0 && xclipRes.stdout) {
    return xclipRes.stdout.trim()
  }
  const wlPasteRes = await execDirect("wl-paste", [])
  if (wlPasteRes.exitCode === 0 && wlPasteRes.stdout) {
    return wlPasteRes.stdout.trim()
  }
  return null
}

// ─── Image format detection ──────────────────────────────────────────────────

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp"

function detectImageFormatFromBuffer(buffer: Uint8Array): ImageMediaType {
  if (buffer.length < 4) return "image/png"

  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return "image/png"
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg"
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif"
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer.length >= 12 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return "image/webp"
  }

  return "image/png"
}

function detectImageFormatFromBase64(base64: string): string {
  const raw = Buffer.from(base64.slice(0, 24), "base64")
  return detectImageFormatFromBuffer(raw)
}

// ─── Path utilities ──────────────────────────────────────────────────────────

function removeOuterQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1)
  }
  return text
}

function stripBackslashEscapes(path: string): string {
  if ((process.platform as SupportedPlatform) === "win32") {
    return path
  }

  const salt = randomBytes(8).toString("hex")
  const placeholder = `__DOUBLE_BACKSLASH_${salt}__`
  const withPlaceholder = path.replace(/\\\\/g, placeholder)
  const withoutEscapes = withPlaceholder.replace(/\\(.)/g, "$1")
  return withoutEscapes.replace(new RegExp(placeholder, "g"), "\\")
}

/**
 * Check if a given text represents an image file path.
 */
export function isImageFilePath(text: string): boolean {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)
  return IMAGE_EXTENSION_REGEX.test(unescaped)
}

/**
 * Clean and normalize a text string that might be an image file path.
 * Returns null if the text does not look like an image path.
 */
export function asImageFilePath(text: string): string | null {
  const cleaned = removeOuterQuotes(text.trim())
  const unescaped = stripBackslashEscapes(cleaned)

  if (IMAGE_EXTENSION_REGEX.test(unescaped)) {
    return unescaped
  }

  return null
}

// ─── Clipboard operations ────────────────────────────────────────────────────

async function getImagePathFromClipboard(): Promise<string | null> {
  try {
    return await getImagePathFromClipboardDirect()
  } catch (e) {
    Log.Default.error("[image-paste] Failed to get clipboard path", { error: e })
    return null
  }
}

/**
 * Read an image from the system clipboard.
 * Uses platform-specific clipboard commands (osascript, xclip, PowerShell).
 *
 * Note: Image resizing via `sharp` is deferred — returns raw buffer as base64.
 */
export async function getImageFromClipboard(): Promise<ImageWithDimensions | null> {
  const screenshotPath = getScreenshotPath()
  try {
    const isImage = await checkImageDirect()
    if (!isImage) {
      return null
    }

    const saved = await saveImageDirect(screenshotPath)
    if (!saved) {
      return null
    }

    const imageBuffer = readFileSync(screenshotPath)
    const base64Image = imageBuffer.toString("base64")
    const mediaType = detectImageFormatFromBase64(base64Image)

    // Cleanup (native unlink)
    try {
      unlinkSync(screenshotPath)
    } catch {
      // ignore
    }

    return { base64: base64Image, mediaType }
  } catch {
    return null
  }
}

/**
 * Try to read an image from a file path.
 * Supports absolute paths and relative paths that match the clipboard filename.
 *
 * Note: Image resizing via `sharp` is deferred — returns raw buffer as base64.
 */
export async function tryReadImageFromPath(text: string): Promise<(ImageWithDimensions & { path: string }) | null> {
  const cleanedPath = asImageFilePath(text)
  if (!cleanedPath) {
    return null
  }

  let imageBuffer: Buffer | undefined

  try {
    if (isAbsolute(cleanedPath)) {
      imageBuffer = readFileSync(cleanedPath)
    } else {
      // VSCode Terminal may provide just the filename instead of full path.
      // Check if it matches the clipboard image's basename.
      const clipboardPath = await getImagePathFromClipboard()
      if (clipboardPath && cleanedPath === basename(clipboardPath)) {
        imageBuffer = readFileSync(clipboardPath)
      }
    }
  } catch (e) {
    Log.Default.error("[image-paste] Failed to read image from path", { error: e })
    return null
  }

  if (!imageBuffer) {
    return null
  }
  if (imageBuffer.length === 0) {
    Log.Default.warn("[image-paste] Image file is empty", { path: cleanedPath })
    return null
  }

  const _ext = extname(cleanedPath).slice(1).toLowerCase() || "png"
  const base64Image = imageBuffer.toString("base64")
  const mediaType = detectImageFormatFromBase64(base64Image)

  return {
    path: cleanedPath,
    base64: base64Image,
    mediaType,
  }
}
