# Quickstart: Engine Loop Decoupling

## What Changed

The engine execution loop is decoupled from direct SQLite access. All persistence goes through a pluggable `Checkpointer` interface. The loop is a forward-only state machine that returns typed results.

## Key Concepts

### Checkpointer

```typescript
import { SqliteCheckpointer, MemoryCheckpointer, NoopCheckpointer } from "./engine/checkpointer"

// Production: same behavior as before
const checkpointer = new SqliteCheckpointer()

// Testing: no DB required
const checkpointer = new MemoryCheckpointer()

// Ephemeral: discard all persistence
const checkpointer = new NoopCheckpointer()
```

### SessionResult

```typescript
const result = await runSessionInner({ sessionID, session, abort, registry, checkpointer })

switch (result.status) {
  case "ok":
    // result.message contains the completed assistant message with parts
    break
  case "error":
    // result.error contains the error; result.message may have partial data
    break
  case "aborted":
    // User cancelled
    break
}
```

### PromiseTracker

```typescript
const tracker = new PromiseTracker()

// Track async side-effects
tracker.track(checkpointer.write(ops))
tracker.track(bus.publish(event))

// In cleanup: ensure everything completes
await tracker.flush()
```

## Migration Guide

### Before (DB-coupled)
```typescript
// loop.ts
await runSession({ sessionID, session, abort, registry })
for await (const item of Message.stream(sessionID)) {
  // Re-read from DB to find result
  return item
}
throw new Error("Impossible")
```

### After (Decoupled)
```typescript
// loop.ts
const result = await runSession({ sessionID, session, abort, registry, checkpointer })
if (result.status === "ok") {
  return result.message
}
```

## Testing

```typescript
import { MemoryCheckpointer } from "./engine/checkpointer"

test("engine runs without DB", async () => {
  const checkpointer = new MemoryCheckpointer()
  const result = await runSessionInner({
    sessionID: "test-session",
    session: mockSession,
    abort: new AbortController().signal,
    registry: new BackgroundTaskRegistry(),
    checkpointer,
  })
  expect(result.status).toBe("ok")
  expect(result.message.parts.length).toBeGreaterThan(0)
})
```
