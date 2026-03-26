import os from "node:os"
import path from "node:path"

const home = os.homedir()

// macOS directories that trigger TCC (Transparency, Consent, and Control)
// permission prompts when accessed by a non-sandboxed process.
const DARWIN_HOME = [
  // Media
  "Music",
  "Pictures",
  "Movies",
  // User-managed folders synced via iCloud / subject to TCC
  "Downloads",
  "Desktop",
  "Documents",
  // Other system-managed
  "Public",
  "Applications",
  "Library",
]

const DARWIN_LIBRARY = [
  "Application Support/AddressBook",
  "Calendars",
  "Mail",
  "Messages",
  "Safari",
  "Cookies",
  "Application Support/com.apple.TCC",
  "PersonalizationPortrait",
  "Metadata/CoreSpotlight",
  "Suggestions",
]

const DARWIN_ROOT = ["/.DocumentRevisions-V100", "/.Spotlight-V100", "/.Trashes", "/.fseventsd"]

const WIN32_HOME = ["AppData", "Downloads", "Desktop", "Documents", "Pictures", "Music", "Videos", "OneDrive"]

export namespace Protected {
  /** Directory basenames to skip when scanning the home directory. */
  export function names(): ReadonlySet<string> {
    if (process.platform === "darwin") return new Set(DARWIN_HOME)
    if (process.platform === "win32") return new Set(WIN32_HOME)
    return new Set()
  }

  /** Absolute paths that should never be watched, stated, or scanned. */
  export function paths(): string[] {
    if (process.platform === "darwin")
      return [
        ...DARWIN_HOME.map((n) => path.join(home, n)),
        ...DARWIN_LIBRARY.map((n) => path.join(home, "Library", n)),
        ...DARWIN_ROOT,
      ]
    if (process.platform === "win32") return WIN32_HOME.map((n) => path.join(home, n))
    return []
  }

  /**
   * Returns true if `dir` should never be fully indexed with ripgrep.
   * Covers: filesystem root, user home, and common system parent dirs.
   */
  export function dangerous(dir: string): boolean {
    const norm = path.resolve(dir)
    const root = path.parse(norm).root
    if (norm === root) return true
    if (norm === path.resolve(home)) return true
    // parent of home (e.g. C:\Users or /Users or /home)
    if (norm === path.resolve(path.dirname(home))) return true
    if (process.platform === "win32") {
      const lower = norm.toLowerCase()
      if (lower === path.join(root, "program files").toLowerCase()) return true
      if (lower === path.join(root, "program files (x86)").toLowerCase()) return true
      if (lower === path.join(root, "windows").toLowerCase()) return true
    }
    if (process.platform === "darwin") {
      const sys = ["/System", "/Library", "/Applications", "/private"]
      if (sys.some((s) => norm === path.resolve(s))) return true
    }
    if (process.platform === "linux") {
      const sys = ["/usr", "/etc", "/var", "/opt", "/proc", "/sys", "/boot", "/dev", "/run", "/srv"]
      if (sys.some((s) => norm === path.resolve(s))) return true
    }
    return false
  }
}
