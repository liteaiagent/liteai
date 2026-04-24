import { describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useTypeahead } from '../src/session/useTypeahead.js'
import type { TypeaheadPorts } from '../src/types.js'

describe('useTypeahead', () => {
  const createMockPorts = (): TypeaheadPorts => ({
    generateCommandSuggestions: mock((input: string, commands: unknown[]) => {
      if (input === '/') {
        return (commands as { name: string }[]).map((c) => ({ id: c.name, displayText: `/${c.name}` }))
      }
      return []
    }),
    generateUnifiedSuggestions: mock(async () => []),
    getShellCompletions: mock(async () => []),
    getShellHistoryCompletion: mock(async () => null),
    getSlackChannelSuggestions: mock(async () => []),
    getDirectoryCompletions: mock(async () => []),
    getPathCompletions: mock(async () => []),
    searchSessionsByCustomTitle: mock(async () => []),
    logEvent: mock(() => {}),
  })

  const mockNotificationPort = {
    addNotification: mock(() => {}),
    removeNotification: mock(() => {}),
  }

  it('should initialize with no suggestions', () => {
    const ports = createMockPorts()
    const { result } = renderHook(() =>
      useTypeahead({
        input: '',
        cursorOffset: 0,
        mode: 'prompt',
        ports,
        notificationPort: mockNotificationPort,
        onInputChange: () => {},
        onSubmit: () => {},
        setCursorOffset: () => {},
      }),
    )

    expect(result.current.suggestions).toEqual([])
    expect(result.current.suggestionType).toBe('none')
  })

  it('should show command suggestions when typing /', async () => {
    const ports = createMockPorts()
    const commands = [{ name: 'help' }, { name: 'clear' }]

    const { result } = renderHook(
      ({ input, commands }) =>
        useTypeahead({
          input,
          cursorOffset: 1,
          mode: 'prompt',
          ports,
          notificationPort: mockNotificationPort,
          onInputChange: () => {},
          onSubmit: () => {},
          setCursorOffset: () => {},
          options: { commands },
        }),
      {
        initialProps: { input: '/', commands },
      },
    )

    // Initially / might not trigger until updateSuggestions runs
    await act(async () => {
      // updateSuggestions runs in useEffect
    })

    expect(result.current.suggestions.length).toBe(2)
    expect(result.current.suggestionType).toBe('command')
    expect(result.current.suggestions[0]?.displayText).toBe('/help')
  })

  it('should navigate suggestions with Arrow keys', async () => {
    const ports = createMockPorts()
    const commands = [{ name: 'help' }, { name: 'clear' }]

    const { result } = renderHook(
      ({ commands }) =>
        useTypeahead({
          input: '/',
          cursorOffset: 1,
          mode: 'prompt',
          ports,
          notificationPort: mockNotificationPort,
          onInputChange: () => {},
          onSubmit: () => {},
          setCursorOffset: () => {},
          options: { commands },
        }),
      {
        initialProps: { commands },
      },
    )

    await act(async () => {})

    expect(result.current.selectedSuggestion).toBe(0)

    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} })
    })

    expect(result.current.selectedSuggestion).toBe(1)

    act(() => {
      result.current.handleKeyDown({ key: 'ArrowDown', preventDefault: () => {} })
    })

    expect(result.current.selectedSuggestion).toBe(0) // Wrap around
  })
})
