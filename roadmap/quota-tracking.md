# Quota Tracking & Usage Tab

**Status:** Proposed  
**Priority:** Medium  
**Scope:** `packages/core` (provider layer, SDK events) + `packages/cli` (state, UI)  
**Reference:** Gemini CLI `packages/core/src/config/config.ts` → `refreshUserQuota()`, `packages/cli/src/ui/components/ModelQuotaDisplay.tsx`

---

## Problem

LiteAI has no mechanism to track or display API quota usage. Users have no visibility into how close they are to hitting rate limits until they receive a 429 error. Gemini CLI solves this with per-model quota progress bars, reset times, and a footer indicator.

## Gemini CLI Architecture (Reference)

### Data Flow

```
Google Code Assist API
  → codeAssistServer.retrieveUserQuota()
  → Config.refreshUserQuota()           // parses buckets, caches with TTL
  → Config.refreshUserQuotaIfStale()     // called after each API response
  → QuotaContext (React)                 // pushes to UI
  → Footer: "N% used"                   // status bar
  → /model: per-model progress bars     // dialog
```

### Server Response Shape

```typescript
interface RetrieveUserQuotaResponse {
  buckets?: Array<{
    modelId?: string
    remainingFraction?: number   // 0.0–1.0 (fraction of quota remaining)
    remainingAmount?: number     // absolute remaining count
    resetTime?: string           // ISO 8601 timestamp
  }>
}
```

### Staleness TTL

- Default: 5 minutes between quota fetches
- Configurable via `refreshUserQuotaIfStale(ttlMs)`
- Fetched proactively after each `generateContent` response

## Proposed LiteAI Design

### Phase 1: Provider-Level Quota Extraction

Each provider adapter should be able to report quota information. Two strategies:

| Strategy | Providers | How |
|---|---|---|
| **Header parsing** | Google (Gemini API) | Parse `x-ratelimit-*` headers or `QuotaFailure` details from 429 responses |
| **Dedicated API** | Google Code Assist | Call `retrieveUserQuota()` endpoint (same as Gemini CLI) |
| **Passive tracking** | All providers | Count requests/tokens per model per window, estimate usage against known limits |

#### New Core Types

```typescript
// packages/core/src/provider/quota.ts

export interface QuotaBucket {
  modelId: string
  providerID: string
  /** Fraction of quota remaining (0.0 = exhausted, 1.0 = full) */
  remainingFraction: number
  /** Absolute remaining count, if known */
  remainingAmount?: number
  /** ISO 8601 reset time, if known */
  resetTime?: string
  /** Human-readable quota metric name */
  metric?: string
}

export interface QuotaState {
  buckets: QuotaBucket[]
  lastRefreshed: number   // Date.now() timestamp
  stale: boolean          // true if TTL has elapsed
}
```

#### Provider Interface Extension

```typescript
// Add to ProviderAdapter interface
interface ProviderAdapter {
  // ... existing methods ...
  
  /** Fetch current quota state. Returns null if provider doesn't support quota tracking. */
  getQuota?(): Promise<QuotaBucket[] | null>
}
```

### Phase 2: Session Integration

- After each `generateContent` response, call `provider.getQuota()` if TTL (5 min) has elapsed
- Cache quota state in session-level store
- Emit `quota.updated` event via SDK event bus

```typescript
// New SDK event
type QuotaUpdatedEvent = {
  type: "quota.updated"
  properties: {
    buckets: QuotaBucket[]
    lastRefreshed: number
  }
}
```

### Phase 3: CLI State & UI

#### App State

New `quota` slice in `AppState`:

```typescript
quota: {
  buckets: QuotaBucket[]
  lastRefreshed: number
  stale: boolean
}
```

#### UI Surface: `/stats` Usage Tab

Add a third tab to the existing `/stats` dialog: **Session | Global | Usage**

The Usage tab displays:
- Per-model progress bars (like Gemini CLI's `ModelQuotaDisplay`)
- Reset time countdown
- Pooled quota summary in the status line footer

#### UI Surface: Status Line Column

New `quota` column in the two-row status line:
```
quota
23% used
```

Shows `—` when quota data unavailable (non-Google providers, pre-first-fetch).

### Phase 4: 429 Error Enhancement

When a 429 error occurs:
1. Parse `QuotaFailure` details from the response body (already partially handled in `provider/error.ts`)
2. Update quota state immediately (don't wait for TTL)
3. Show retry countdown in the status line
4. Toast notification with reset time

## Implementation Order

1. `packages/core`: Define `QuotaBucket` / `QuotaState` types
2. `packages/core`: Implement `getQuota()` for Google provider (parse 429 + dedicated API)
3. `packages/core`: Add staleness-guarded refresh in session engine
4. `packages/sdk`: Add `quota.updated` event type
5. `packages/cli`: Add `quota` app state slice + event listener
6. `packages/cli`: Add Usage tab to `/stats` dialog
7. `packages/cli`: Add quota column to status line

## Open Questions

- Should passive request counting (for providers without quota APIs) be Phase 1 or deferred?
- Should quota data persist across sessions (local cache) or be session-scoped?
- Do we want a configurable alert threshold (e.g., toast at 80% usage)?
