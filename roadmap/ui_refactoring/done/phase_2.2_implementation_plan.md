# Implementation Plan - Phase 2.2: Foundation Contexts

Build the foundational React context providers for the CLI TUI, mirroring the existing SolidJS architecture.

## Proposed Changes

### [Component] CLI TUI Contexts (`packages/cli/src/tui/context/`)

#### [NEW] [args.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/args.tsx)
- Port from `cli/cmd/tui/context/args.tsx`.
- Simple value context for CLI arguments.

#### [NEW] [exit.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/exit.tsx)
- Port from `cli/cmd/tui/context/exit.tsx`.
- Uses `useApp` from `@liteai/ink` for exit functionality.
- Resets terminal title on exit.
- Handles error formatting and final message output.

#### [NEW] [kv.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/kv.tsx)
- Port from `cli/cmd/tui/context/kv.tsx`.
- Persistent key-value store using `useState` and filesystem JSON.
- Provides a `.signal()` helper that returns a `[getter, setter]` pair compatible with SolidJS-style usage (but backed by React state).

#### [NEW] [tui-config.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/tui-config.tsx)
- Port from `cli/cmd/tui/context/tui-config.tsx`.
- Simple configuration passthrough.

#### [NEW] [prompt.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/prompt.tsx)
- Port from `cli/cmd/tui/context/prompt.tsx`.
- Holds a reference to the active prompt component for imperative control.

#### [NEW] [route.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/route.tsx)
- Port from `cli/cmd/tui/context/route.tsx`.
- Manages TUI navigation state (Home vs Session).
- Initializes from `process.env.LITEAI_ROUTE` if present.

#### [NEW] [sdk.tsx](file:///c:/Users/aghassan/Documents/workspace/liteai/packages/cli/src/tui/context/sdk.tsx)
- Port from `cli/cmd/tui/context/sdk.tsx`.
- Manages the LiteAI SDK client and SSE event stream.
- Uses `createEventEmitter` from `src/tui/util/event-emitter.ts`.
- Implements event batching and throttling for performance.
- Handles workspace/project switching.

## Verification Plan

### Automated Tests
- Run `bun typecheck` to ensure all new contexts are type-safe.
- Run `bun lint:fix` to ensure code style compliance.

### Manual Verification
- N/A for this phase as these are foundational contexts without a visual UI yet. Integration will be verified in Phase 2.3 and beyond.
