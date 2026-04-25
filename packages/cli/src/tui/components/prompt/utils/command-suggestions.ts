import type { Info } from "@liteai/core/config/schema"
import type { Command } from "@liteai/sdk"
import Fuse from "fuse.js"
import { getSkillUsageScore } from "./skill-usage-tracking"
import type { SuggestionItem } from "./types"

// Helpers to extract name and description from Command type
export function getCommandName(cmd: Command): string {
  return cmd.name
}

function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.description) {
    return cmd.description
  }
  return "Command"
}

// Treat these characters as word separators for command search
const SEPARATORS = /[:_-]/g

type CommandSearchItem = {
  descriptionKey: string[]
  partKey: string[] | undefined
  commandName: string
  command: Command
  aliasKey: string[] | undefined
}

let fuseCache: {
  commands: Command[]
  fuse: Fuse<CommandSearchItem>
} | null = null

function getCommandFuse(commands: Command[]): Fuse<CommandSearchItem> {
  if (fuseCache?.commands === commands) {
    return fuseCache.fuse
  }

  const commandData: CommandSearchItem[] = commands.map((cmd) => {
    const commandName = getCommandName(cmd)
    const parts = commandName.split(SEPARATORS).filter(Boolean)

    return {
      descriptionKey: (cmd.description ?? "")
        .split(" ")
        .map((word) => cleanWord(word))
        .filter(Boolean),
      partKey: parts.length > 1 ? parts : undefined,
      commandName,
      command: cmd,
      aliasKey: undefined, // Add aliases if Command type supports it in the future
    }
  })

  const fuse = new Fuse(commandData, {
    includeScore: true,
    threshold: 0.3, // relatively strict matching
    location: 0, // prefer matches at the beginning of strings
    distance: 100, // increased to allow matching in descriptions
    keys: [
      {
        name: "commandName",
        weight: 3, // Highest priority for command names
      },
      {
        name: "partKey",
        weight: 2, // Next highest priority for command parts
      },
      {
        name: "aliasKey",
        weight: 2, // Same high priority for aliases
      },
      {
        name: "descriptionKey",
        weight: 0.5, // Lower priority for descriptions
      },
    ],
  })

  fuseCache = { commands, fuse }
  return fuse
}

function isCommandMetadata(metadata: unknown): metadata is Command {
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    "name" in metadata &&
    typeof (metadata as { name: unknown }).name === "string"
  )
}

export type MidInputSlashCommand = {
  token: string // e.g., "/com"
  startPos: number // Position of "/"
  partialCommand: string // e.g., "com"
}

export function findMidInputSlashCommand(input: string, cursorOffset: number): MidInputSlashCommand | null {
  if (input.startsWith("/")) {
    return null
  }

  const beforeCursor = input.slice(0, cursorOffset)
  const match = beforeCursor.match(/\s\/([a-zA-Z0-9_:-]*)$/)
  if (!match || match.index === undefined) {
    return null
  }

  const slashPos = match.index + 1
  const textAfterSlash = input.slice(slashPos + 1)
  const commandMatch = textAfterSlash.match(/^[a-zA-Z0-9_:-]*/)
  const fullCommand = commandMatch ? commandMatch[0] : ""

  if (cursorOffset > slashPos + 1 + fullCommand.length) {
    return null
  }

  return {
    token: `/${fullCommand}`,
    startPos: slashPos,
    partialCommand: fullCommand,
  }
}

export function getBestCommandMatch(
  partialCommand: string,
  commands: Command[],
  config: Info,
): { suffix: string; fullCommand: string } | null {
  if (!partialCommand) {
    return null
  }

  const suggestions = generateCommandSuggestions(`/${partialCommand}`, commands, config)
  if (suggestions.length === 0) {
    return null
  }

  const query = partialCommand.toLowerCase()
  for (const suggestion of suggestions) {
    if (!isCommandMetadata(suggestion.metadata)) {
      continue
    }
    const name = getCommandName(suggestion.metadata)
    if (name.toLowerCase().startsWith(query)) {
      const suffix = name.slice(partialCommand.length)
      if (suffix) {
        return { suffix, fullCommand: name }
      }
    }
  }

  return null
}

export function isCommandInput(input: string): boolean {
  return input.startsWith("/")
}

export function hasCommandArgs(input: string): boolean {
  if (!isCommandInput(input)) return false
  if (!input.includes(" ")) return false
  if (input.endsWith(" ")) return false
  return true
}

export function formatCommand(command: string): string {
  return `/${command} `
}

function getCommandId(cmd: Command): string {
  return `${getCommandName(cmd)}`
}

function findMatchedAlias(query: string, aliases?: string[]): string | undefined {
  if (!aliases || aliases.length === 0 || query === "") {
    return undefined
  }
  return aliases.find((alias) => alias.toLowerCase().startsWith(query))
}

function createCommandSuggestionItem(cmd: Command, matchedAlias?: string): SuggestionItem {
  const commandName = getCommandName(cmd)
  const aliasText = matchedAlias ? ` (${matchedAlias})` : ""

  return {
    id: getCommandId(cmd),
    displayText: `/${commandName}${aliasText}`,
    description: formatDescriptionWithSource(cmd),
    metadata: cmd,
  }
}

export function generateCommandSuggestions(input: string, commands: Command[], config: Info): SuggestionItem[] {
  if (!isCommandInput(input)) {
    return []
  }

  if (hasCommandArgs(input)) {
    return []
  }

  const query = input.slice(1).toLowerCase().trim()

  if (query === "") {
    const visibleCommands = commands

    const recentlyUsed: Command[] = []
    const commandsWithScores = visibleCommands
      .map((cmd) => ({
        cmd,
        score: getSkillUsageScore(getCommandName(cmd), config),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)

    for (const item of commandsWithScores.slice(0, 5)) {
      recentlyUsed.push(item.cmd)
    }

    const recentlyUsedIds = new Set(recentlyUsed.map((cmd) => getCommandId(cmd)))

    const otherCommands: Command[] = []
    visibleCommands.forEach((cmd) => {
      if (recentlyUsedIds.has(getCommandId(cmd))) {
        return
      }
      otherCommands.push(cmd)
    })

    const sortAlphabetically = (a: Command, b: Command) => getCommandName(a).localeCompare(getCommandName(b))

    otherCommands.sort(sortAlphabetically)

    return [...recentlyUsed, ...otherCommands].map((cmd) => createCommandSuggestionItem(cmd))
  }

  const fuse = getCommandFuse(commands)
  const searchResults = fuse.search(query)

  const withMeta = searchResults.map((r) => {
    const name = r.item.commandName.toLowerCase()
    const aliases = r.item.aliasKey?.map((alias) => alias.toLowerCase()) ?? []
    const usage = getSkillUsageScore(getCommandName(r.item.command), config)
    return { r, name, aliases, usage }
  })

  const sortedResults = withMeta.sort((a, b) => {
    const aName = a.name
    const bName = b.name
    const aAliases = a.aliases
    const bAliases = b.aliases

    const aExactName = aName === query
    const bExactName = bName === query
    if (aExactName && !bExactName) return -1
    if (bExactName && !aExactName) return 1

    const aExactAlias = aAliases.some((alias) => alias === query)
    const bExactAlias = bAliases.some((alias) => alias === query)
    if (aExactAlias && !bExactAlias) return -1
    if (bExactAlias && !aExactAlias) return 1

    const aPrefixName = aName.startsWith(query)
    const bPrefixName = bName.startsWith(query)
    if (aPrefixName && !bPrefixName) return -1
    if (bPrefixName && !aPrefixName) return 1
    if (aPrefixName && bPrefixName && aName.length !== bName.length) {
      return aName.length - bName.length
    }

    const aPrefixAlias = aAliases.find((alias) => alias.startsWith(query))
    const bPrefixAlias = bAliases.find((alias) => alias.startsWith(query))
    if (aPrefixAlias && !bPrefixAlias) return -1
    if (bPrefixAlias && !aPrefixAlias) return 1
    if (aPrefixAlias && bPrefixAlias && aPrefixAlias.length !== bPrefixAlias.length) {
      return aPrefixAlias.length - bPrefixAlias.length
    }

    const scoreDiff = (a.r.score ?? 0) - (b.r.score ?? 0)
    if (Math.abs(scoreDiff) > 0.1) {
      return scoreDiff
    }
    return b.usage - a.usage
  })

  return sortedResults.map((result) => {
    const cmd = result.r.item.command
    const matchedAlias = findMatchedAlias(query, result.r.item.aliasKey)
    return createCommandSuggestionItem(cmd, matchedAlias)
  })
}

export function getCommand(commandName: string, commands: Command[]): Command | undefined {
  return commands.find((c) => getCommandName(c) === commandName)
}

export function applyCommandSuggestion(
  suggestion: string | SuggestionItem,
  shouldExecute: boolean,
  commands: Command[],
  currentInput: string,
  midCommandMatch: MidInputSlashCommand | null,
  onInputChange: (value: string) => void,
  setCursorOffset: (offset: number) => void,
  onSubmit: (value: string, isSubmittingSlashCommand?: boolean) => void,
): void {
  let commandName: string
  let commandObj: Command | undefined

  if (typeof suggestion === "string") {
    commandName = suggestion
    commandObj = shouldExecute ? getCommand(commandName, commands) : undefined
  } else {
    if (!isCommandMetadata(suggestion.metadata)) {
      return
    }
    commandName = getCommandName(suggestion.metadata)
    commandObj = suggestion.metadata
  }

  const formatted = formatCommand(commandName)
  let newInput = formatted
  let newCursor = formatted.length

  if (midCommandMatch) {
    const before = currentInput.slice(0, midCommandMatch.startPos)
    const after = currentInput.slice(midCommandMatch.startPos + midCommandMatch.token.length)
    newInput = `${before}${formatted}${after}`
    newCursor = before.length + formatted.length
  }

  onInputChange(newInput)
  setCursorOffset(newCursor)

  if (shouldExecute && commandObj) {
    // If command doesn't take arguments or doesn't have required arguments (as per config)
    onSubmit(newInput, true)
  }
}

function cleanWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, "")
}

export function findSlashCommandPositions(text: string): Array<{ start: number; end: number }> {
  const positions: Array<{ start: number; end: number }> = []
  const regex = /(^|[\s])(\/[a-zA-Z][a-zA-Z0-9:\-_]*)/g
  let match = regex.exec(text)
  while (match !== null) {
    const precedingChar = match[1] ?? ""
    const commandName = match[2] ?? ""
    const start = match.index + precedingChar.length
    positions.push({ start, end: start + commandName.length })
    match = regex.exec(text)
  }
  return positions
}
