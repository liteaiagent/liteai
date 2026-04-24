import Fuse from 'fuse.js'
import type { SuggestionItem } from '../types.js'

export interface Command {
  name?: string
  description?: string
  aliases?: string[]
  isHidden?: boolean
  type: string
  source?: string
  pluginInfo?: { repository: string }
  kind?: string
  argNames?: string[]
  argumentHint?: string
}

export function getCommandName(cmd: Command): string {
  return cmd.name ?? ''
}

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

function cleanWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function getCommandFuse(commands: Command[]): Fuse<CommandSearchItem> {
  if (fuseCache?.commands === commands) {
    return fuseCache.fuse
  }

  const commandData: CommandSearchItem[] = commands
    .filter((cmd) => !cmd.isHidden)
    .map((cmd) => {
      const commandName = getCommandName(cmd)
      const parts = commandName.split(SEPARATORS).filter(Boolean)

      return {
        descriptionKey: (cmd.description ?? '')
          .split(' ')
          .map((word) => cleanWord(word))
          .filter(Boolean),
        partKey: parts.length > 1 ? parts : undefined,
        commandName,
        command: cmd,
        aliasKey: cmd.aliases,
      }
    })

  const fuse = new Fuse(commandData, {
    includeScore: true,
    threshold: 0.3,
    location: 0,
    distance: 100,
    keys: [
      { name: 'commandName', weight: 3 },
      { name: 'partKey', weight: 2 },
      { name: 'aliasKey', weight: 2 },
      { name: 'descriptionKey', weight: 0.5 },
    ],
  })

  fuseCache = { commands, fuse }
  return fuse
}

export type MidInputSlashCommand = {
  token: string
  startPos: number
  partialCommand: string
}

export function findMidInputSlashCommand(input: string, cursorOffset: number): MidInputSlashCommand | null {
  if (input.startsWith('/')) return null
  const beforeCursor = input.slice(0, cursorOffset)
  const match = beforeCursor.match(/\s\/([a-zA-Z0-9_:-]*)$/)
  if (!match || match.index === undefined) return null

  const slashPos = match.index + 1
  const textAfterSlash = input.slice(slashPos + 1)
  const commandMatch = textAfterSlash.match(/^[a-zA-Z0-9_:-]*/)
  const fullCommand = commandMatch ? commandMatch[0] : ''

  if (cursorOffset > slashPos + 1 + fullCommand.length) return null

  return {
    token: `/${fullCommand}`,
    startPos: slashPos,
    partialCommand: fullCommand,
  }
}

export function isCommandInput(input: string): boolean {
  return input.startsWith('/')
}

export function hasCommandArgs(input: string): boolean {
  if (!isCommandInput(input)) return false
  if (!input.includes(' ')) return false
  if (input.endsWith(' ')) return false
  return true
}

export function getCommandId(cmd: Command): string {
  const commandName = getCommandName(cmd)
  if (cmd.type === 'prompt') {
    if (cmd.source === 'plugin' && cmd.pluginInfo?.repository) {
      return `${commandName}:${cmd.source}:${cmd.pluginInfo.repository}`
    }
    return `${commandName}:${cmd.source}`
  }
  return `${commandName}:${cmd.type}`
}

function findMatchedAlias(query: string, aliases?: string[]): string | undefined {
  if (!aliases || aliases.length === 0 || query === '') return undefined
  return aliases.find((alias) => alias.toLowerCase().startsWith(query))
}

function createCommandSuggestionItem(cmd: Command, matchedAlias?: string): SuggestionItem {
  const commandName = getCommandName(cmd)
  const aliasText = matchedAlias ? ` (${matchedAlias})` : ''
  const _isWorkflow = cmd.type === 'prompt' && cmd.kind === 'workflow'

  return {
    id: getCommandId(cmd),
    displayText: `/${commandName}${aliasText}`,
    description: cmd.description,
    metadata: cmd,
  }
}

export function generateCommandSuggestions(
  input: string,
  commands: Command[],
  getScore: (name: string) => number = () => 0,
): SuggestionItem[] {
  if (!isCommandInput(input) || hasCommandArgs(input)) return []

  const query = input.slice(1).toLowerCase().trim()

  if (query === '') {
    const visibleCommands = commands.filter((cmd) => !cmd.isHidden)
    return visibleCommands
      .sort((a, b) => getCommandName(a).localeCompare(getCommandName(b)))
      .map((cmd) => createCommandSuggestionItem(cmd))
  }

  const fuse = getCommandFuse(commands)
  const searchResults = fuse.search(query)

  const withMeta = searchResults.map((r) => {
    const name = r.item.commandName.toLowerCase()
    const aliases = r.item.aliasKey?.map((alias) => alias.toLowerCase()) ?? []
    const usage = getScore(getCommandName(r.item.command))
    return { r, name, aliases, usage }
  })

  const sortedResults = withMeta.sort((a, b) => {
    const aExactName = a.name === query
    const bExactName = b.name === query
    if (aExactName && !bExactName) return -1
    if (bExactName && !aExactName) return 1

    const aPrefixName = a.name.startsWith(query)
    const bPrefixName = b.name.startsWith(query)
    if (aPrefixName && !bPrefixName) return -1
    if (bPrefixName && !aPrefixName) return 1
    if (aPrefixName && bPrefixName && a.name.length !== b.name.length) {
      return a.name.length - b.name.length
    }

    const scoreDiff = (a.r.score ?? 0) - (b.r.score ?? 0)
    if (Math.abs(scoreDiff) > 0.1) return scoreDiff
    return b.usage - a.usage
  })

  return sortedResults.map((result) => {
    const cmd = result.r.item.command
    const matchedAlias = findMatchedAlias(query, cmd.aliases)
    return createCommandSuggestionItem(cmd, matchedAlias)
  })
}

export function getBestCommandMatch(
  partialCommand: string,
  commands: Command[],
): { suffix: string; fullCommand: string } | null {
  if (!partialCommand) return null
  const suggestions = generateCommandSuggestions(`/${partialCommand}`, commands)
  if (suggestions.length === 0) return null

  const query = partialCommand.toLowerCase()
  for (const suggestion of suggestions) {
    const cmd = suggestion.metadata as Command
    const name = getCommandName(cmd)
    if (name.toLowerCase().startsWith(query)) {
      const suffix = name.slice(partialCommand.length)
      if (suffix) return { suffix, fullCommand: name }
    }
  }
  return null
}
