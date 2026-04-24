# Walkthrough - Phase 2.2: Foundation Contexts

I have implemented the foundational React context providers for the CLI TUI, porting them from the existing SolidJS architecture.

## Changes Made

### CLI TUI Contexts

I have created 7 new React context providers in `packages/cli/src/tui/context/`:

1.  **`args.tsx`**: Simple value context for CLI arguments.
2.  **`exit.tsx`**: Manages app exit logic, using `@liteai/ink` hooks for unmounting and terminal title management.
3.  **`kv.tsx`**: Persistent key-value store backed by filesystem JSON, providing a SolidJS-compatible `.signal()` helper.
4.  **`tui-config.tsx`**: Passthrough for TUI-specific configuration.
5.  **`prompt.tsx`**: Reference holder for the active prompt component, allowing imperative control.
6.  **`route.tsx`**: TUI navigation state management (Home vs Session).
7.  **`sdk.tsx`**: LiteAI SDK client management and SSE event stream processing with batching/throttling.

## Verification Results

### Automated Tests
- `bun typecheck`: **PASSED**
- `bun lint:fix`: **PASSED** (all files are Biome-compliant)

## Code Highlights

### `sdk.tsx` Event Batching
The React version of `sdk.tsx` preserves the event batching logic to optimize render performance:
```tsx
    const flush = useCallback(() => {
      if (queueRef.current.length === 0) return
      const events = queueRef.current
      queueRef.current = []
      timerRef.current = undefined
      lastFlushRef.current = Date.now()

      for (const event of events) {
        emitter.emit(event.type, event)
      }
    }, [emitter])
```

### `kv.tsx` Compatibility
The `.signal()` helper in `kv.tsx` provides a way for React components to use SolidJS-style signal patterns if needed, while staying backed by React state:
```tsx
    const signal = useCallback(
      <T,>(name: string, defaultValue: T) => {
        if (store[name] === undefined) {
          set(name, defaultValue)
        }

        return [
          () => store[name] as T,
          (next: T | ((prev: T) => T)) => {
            // ... setter logic ...
          },
        ] as const
      },
      [store, set],
    )
```
