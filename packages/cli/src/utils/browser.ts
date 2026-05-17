export function openUrlInBrowser(url: string) {
  try {
    if (process.platform === "win32") {
      // Use PowerShell Start-Process to avoid cmd.exe treating '&' in URLs as command separators
      Bun.spawn(
        [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          `Start-Process '${url.replace(/'/g, "''")}'`,
        ],
        { stdout: "ignore", stderr: "ignore" },
      )
    } else {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open"
      Bun.spawn([cmd, url], { stdout: "ignore", stderr: "ignore" })
    }
  } catch {
    // Browser open is best-effort
  }
}
