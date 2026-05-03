/**
 * Sensitive information redaction patterns.
 * Port of Claude Code's redactSensitiveInfo pattern set.
 */

/**
 * Redact sensitive information from a string.
 * Covers API keys, AWS credentials, GCP keys, Bearer tokens,
 * authorization headers, and env vars with secret-like names.
 */
export function redactSensitiveInfo(text: string): string {
  let redacted = text

  // Anthropic / generic API keys (sk-ant..., sk-...)
  redacted = redacted.replace(/"(sk-ant[^\s"']{24,})"/g, '"[REDACTED_API_KEY]"')
  redacted = redacted.replace(/(sk-ant-?[A-Za-z0-9_-]{10,})/g, "[REDACTED_API_KEY]")
  // Generic sk- prefix keys
  redacted = redacted.replace(/(sk-[A-Za-z0-9_-]{20,})/g, "[REDACTED_API_KEY]")

  // AWS access keys (AKIA...)
  redacted = redacted.replace(/(AKIA[A-Z0-9]{16})/g, "[REDACTED_AWS_KEY]")
  // AWS keys in "AWS key: " pattern
  redacted = redacted.replace(/AWS key: "(AWS[A-Z0-9]{20,})"/g, 'AWS key: "[REDACTED_AWS_KEY]"')

  // Google Cloud API keys (AIza...)
  redacted = redacted.replace(/(AIza[A-Za-z0-9_-]{35})/g, "[REDACTED_GCP_KEY]")

  // GCP service account emails
  redacted = redacted.replace(/([a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com)/g, "[REDACTED_GCP_SERVICE_ACCOUNT]")

  // Generic API key headers
  redacted = redacted.replace(/(["']?x-api-key["']?\s*[:=]\s*["']?)[^"',\s)}\]]+/gi, "$1[REDACTED_API_KEY]")

  // Authorization headers / Bearer tokens
  redacted = redacted.replace(
    /(["']?authorization["']?\s*[:=]\s*["']?(bearer\s+)?)[^"',\s)}\]]+/gi,
    "$1[REDACTED_TOKEN]",
  )

  // AWS environment variables
  redacted = redacted.replace(/(AWS[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, "$1[REDACTED_AWS_VALUE]")

  // GCP environment variables
  redacted = redacted.replace(/(GOOGLE[_-][A-Za-z0-9_]+\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi, "$1[REDACTED_GCP_VALUE]")

  // Generic secret-like env vars
  redacted = redacted.replace(
    /((API[-_]?KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*)["']?[^"',\s)}\]]+["']?/gi,
    "$1[REDACTED]",
  )

  // Home directory paths (replace with ~)
  const home = process.env.HOME || process.env.USERPROFILE
  if (home) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    redacted = redacted.replace(new RegExp(escaped, "g"), "~")
  }

  return redacted
}
