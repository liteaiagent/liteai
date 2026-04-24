const supportsHyperlinks = { stdout: true }

// OSC 8 hyperlink escape sequences
// Format: \e]8;;URL\e\\TEXT\e]8;;\e\\
export function hyperlink(url: string, text: string): string {
  if (!supportsHyperlinks.stdout) {
    return text
  }
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`
}
