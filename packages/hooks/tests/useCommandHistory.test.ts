import { describe, expect, it, mock } from 'bun:test'
import { act, renderHook } from '@testing-library/react'
import { useCommandHistory } from '../src/session/useCommandHistory.js'
import type { CommandHistoryPorts, HistoryEntry } from '../src/types.js'

describe('useCommandHistory', () => {
  const mockHistory: HistoryEntry[] = [
    { display: 'third command' },
    { display: 'second command' },
    { display: 'first command' },
  ]

  const createMockPorts = (history: HistoryEntry[] = mockHistory): CommandHistoryPorts => ({
    getHistory: async function* () {
      for (const entry of history) {
        yield entry
      }
    },
    getModeFromInput: mock((input: string) => {
      if (input.startsWith('/')) return 'prompt'
      if (input.startsWith('!')) return 'bash'
      return 'prompt'
    }),
  })

  const mockNotificationPort = {
    addNotification: mock(() => {}),
    removeNotification: mock(() => {}),
  }

  it('should initialize with index 0', () => {
    const ports = createMockPorts()
    const { result } = renderHook(() => useCommandHistory(() => {}, '', {}, ports, mockNotificationPort))

    expect(result.current.historyIndex).toBe(0)
  })

  it('should navigate up and down through history', async () => {
    let currentInput = ''
    const onSetInput = (val: string) => {
      currentInput = val
    }

    const ports = createMockPorts()
    const { result } = renderHook(() => useCommandHistory(onSetInput, currentInput, {}, ports, mockNotificationPort))

    // Press Up
    await act(async () => {
      result.current.onHistoryUp()
    })

    // Index 1 should be 'third command' (most recent first)
    expect(currentInput).toBe('third command')
    expect(result.current.historyIndex).toBe(1)

    // Press Up again
    await act(async () => {
      result.current.onHistoryUp()
    })

    expect(currentInput).toBe('second command')
    expect(result.current.historyIndex).toBe(2)

    // Press Down
    await act(async () => {
      result.current.onHistoryDown()
    })

    expect(currentInput).toBe('third command')
    expect(result.current.historyIndex).toBe(1)

    // Press Down again (return to draft)
    await act(async () => {
      result.current.onHistoryDown()
    })

    expect(currentInput).toBe('')
    expect(result.current.historyIndex).toBe(0)
  })

  it('should preserve draft when navigating away', async () => {
    let currentInput = 'draft content'
    const onSetInput = (val: string) => {
      currentInput = val
    }

    const ports = createMockPorts()
    const { result } = renderHook(() => useCommandHistory(onSetInput, currentInput, {}, ports, mockNotificationPort))

    // Press Up
    await act(async () => {
      result.current.onHistoryUp()
    })

    expect(currentInput).toBe('third command')

    // Press Down to return to draft
    await act(async () => {
      result.current.onHistoryDown()
    })

    expect(currentInput).toBe('draft content')
  })
})
