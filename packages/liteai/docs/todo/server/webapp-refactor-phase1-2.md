# Web App Refactor — Phase 1-2: Foundation + Global Renames

## Phase 1: Foundation

### 1.1 Create `toProjectID` utility

**New file**: `src/utils/project-id.ts`

```ts
import { base64Encode } from "@liteai/util/encode"

/** Map directory path → projectID for SDK API calls */
export function toProjectID(directory: string): string {
  return base64Encode(directory)
}
```

### 1.2 Update SDK context to expose `projectID`

**File**: `src/context/sdk.tsx`

```diff
+import { toProjectID } from "@/utils/project-id"

 return {
   get directory() { return directory() },
+  get projectID() { return toProjectID(directory()) },
   get client() { return client() },
   ...
 }
```

### 1.3 Update `global-sync.tsx` — add `projectIDFor` helper

**File**: `src/context/global-sync.tsx`

```diff
+import { toProjectID } from "@/utils/project-id"
```

No changes to `createSdkForServer` yet — the `directory` header stays for now as a safety net during transition.

---

## Phase 2: Global Route Renames

Simple find-and-replace — no state changes needed.

### Change List

| # | File | Line | Old | New |
|---|------|------|-----|-----|
| 1 | `context/global-sdk.tsx` | 133 | `eventSdk.global.event({...})` | `eventSdk.event.subscribe({...})` |
| 2 | `context/global-sync.tsx` | 356 | `globalSDK.client.global.config.update(...)` | `globalSDK.client.config.update(...)` |
| 3 | `context/global-sync/bootstrap.ts` | 42 | `input.globalSDK.global.health()` | `input.globalSDK.health()` |
| 4 | `context/global-sync/bootstrap.ts` | 58 | `input.globalSDK.global.config.get()` | `input.globalSDK.config.get()` |
| 5 | `context/global-sync/bootstrap.ts` | 87 | `input.globalSDK.global.path()` | `input.globalSDK.path()` |
| 6 | `pages/log.tsx` | 162 | `sdk.client.global.log()` | `sdk.client.log()` |
| 7 | `components/dialog-select-directory.tsx` | 264 | `sdk.client.global.path()` | `sdk.client.path()` |
| 8 | `components/dialog-select-directory.tsx` | 328 | `sdk.client.global.browse()` | `sdk.client.browse()` |
| 9 | `components/settings-providers.tsx` | 117 | `globalSDK.client.global.dispose()` | `globalSDK.client.dispose()` |
| 10 | `components/dialog-connect-provider.tsx` | 199 | `globalSDK.client.global.dispose()` | `globalSDK.client.dispose()` |
| 11 | `utils/server-health.ts` | 80 | `.global.health()` | `.health()` |

### Verification

After all renames, run `biome check` and `tsc --noEmit` to verify no type errors. The new SDK methods are already generated.
