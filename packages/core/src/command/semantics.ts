/**
 * Command semantics configuration for interpreting exit codes in different contexts.
 *
 * Many commands use exit codes to convey information other than just success/failure.
 * For example, grep returns 1 when no matches are found, which is not an error condition.
 *
 */

export interface CommandInterpretation {
  isError: boolean
  message?: string
}

type CommandSemantic = (exitCode: number, stdout: string, stderr: string) => CommandInterpretation

/**
 * Default semantic: treat only 0 as success, everything else as error.
 */
const DEFAULT_SEMANTIC: CommandSemantic = (exitCode, _stdout, _stderr) => ({
  isError: exitCode !== 0,
  message: exitCode !== 0 ? `Command failed with exit code ${exitCode}` : undefined,
})

/**
 * Command-specific semantics.
 */
const COMMAND_SEMANTICS: Map<string, CommandSemantic> = new Map([
  // grep: 0=matches found, 1=no matches, 2+=error
  [
    "grep",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "No matches found" : undefined,
    }),
  ],

  // ripgrep has same semantics as grep
  [
    "rg",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "No matches found" : undefined,
    }),
  ],

  // find: 0=success, 1=partial success (some dirs inaccessible), 2+=error
  [
    "find",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Some directories were inaccessible" : undefined,
    }),
  ],

  // diff: 0=no differences, 1=differences found, 2+=error
  [
    "diff",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Files differ" : undefined,
    }),
  ],

  // test/[: 0=condition true, 1=condition false, 2+=error
  [
    "test",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Condition is false" : undefined,
    }),
  ],

  // [ is an alias for test
  [
    "[",
    (exitCode, _stdout, _stderr) => ({
      isError: exitCode >= 2,
      message: exitCode === 1 ? "Condition is false" : undefined,
    }),
  ],
])

/**
 * Extract the primary command name from a potentially compound command line.
 * Takes the last segment (after pipes/operators) since that determines the exit code.
 *
 * This is a heuristic extraction — don't depend on it for security.
 */
function extractBaseCommand(command: string): string {
  // Split on pipes (|) and control operators (&& || ;) to get individual commands
  const segments = command.split(/\s*(?:\|\||&&|[|;])\s*/)
  // Take the last command as that's what determines the exit code
  const lastCommand = (segments[segments.length - 1] ?? command).trim()
  return lastCommand.split(/\s+/)[0] ?? ""
}

/**
 * Interpret command result based on semantic rules.
 *
 * Returns whether the result represents an error and an optional
 * human-readable message for non-error exit codes with special meaning
 * (e.g., grep exit 1 = "No matches found").
 */
export function interpretCommandResult(
  command: string,
  exitCode: number,
  stdout: string,
  stderr: string,
): CommandInterpretation {
  const baseCommand = extractBaseCommand(command)
  const semantic = COMMAND_SEMANTICS.get(baseCommand) ?? DEFAULT_SEMANTIC
  return semantic(exitCode, stdout, stderr)
}
