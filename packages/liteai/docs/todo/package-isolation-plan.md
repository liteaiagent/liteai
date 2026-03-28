# Package Isolation Plan: TUI/CLI ? Core

## Current State

### Dependency Direction (Target)

```
@liteai/cli --? liteai  (runtime dependency, correct)
liteai       --? @liteai/cli  (FORBIDDEN � core must not know its consumers)
```

### What Was Done (Phase 1 Complete)

- All `packages/liteai/test/cli/` test files deleted
- All 6 test files migrated to `packages/cli/test/cli/`
- `@liteai/cli` devDependency removed from `packages/liteai/package.json`
- `@tui/*` and `@liteai/cli/*` aliases removed from `packages/liteai/tsconfig.json`
- Both packages typecheck clean

---

## Remaining Technical Debt: The @/* Alias in CLI

`packages/cli/tsconfig.json` still has:

```json
"@/*": ["../liteai/src/*"]
```

No CLI source file uses `@/` it exists purely because tsgo follows import
chains into liteai source (which exports raw .ts files) and needs to resolve
liteai's own internal `@/bus/global` etc.

This means CLI's typecheck re-type-checks all of liteai's source.

Root cause: liteai exports raw .ts source files, so tsgo treats them as
first-party code rather than opaque library declarations.

---

## Phase 2 � True TypeScript Isolation

Make liteai a composite project that emits .d.ts files. CLI then sees
opaque type declarations, not raw source.

### Step 1: packages/liteai/tsconfig.json

```diff
  "compilerOptions": {
+   "composite": true,
+   "declaration": true,
+   "declarationDir": "./dist/types",
+   "emitDeclarationOnly": true,
  }
```

### Step 2: packages/liteai/package.json exports

```json
"exports": {
  "./*": {
    "types":   "./dist/types/*.d.ts",
    "bun":     "./src/*.ts",
    "default": "./src/*.ts"
  }
}
```

### Step 3: packages/cli/tsconfig.json

```diff
  "compilerOptions": {
-   "@/*": ["../liteai/src/*"],
    "@tui/*": ["./src/cli/cmd/tui/*"]
  },
+ "references": [{ "path": "../liteai" }]
```

### Step 4: Build ordering (turbo.json)

```json
{
  "tasks": {
    "typecheck": { "dependsOn": ["^typecheck"] }
  }
}
```

---

## Phase 3 � Package Rename (Future)

Rename liteai package name to @liteai/core and update all import specifiers
workspace-wide from `liteai/` to `@liteai/core/`.

---

## Architecture Rule

Dependency direction must always be downward:

```
@liteai/cli    --? @liteai/core
@liteai/app    --? @liteai/core
@liteai/vscode --? @liteai/core

@liteai/core CANNOT import any consumer package.
Tests in @liteai/core may only test core logic.
Tests for CLI features live in @liteai/cli.
```

---

## Checklist

### Phase 1 (Complete)
- [x] Move all liteai/test/cli/ test files to cli/test/cli/
- [x] Fix mock module paths in thread.test.ts
- [x] Create packages/cli/test/fixture/fixture.ts
- [x] Delete packages/liteai/test/cli/ directory
- [x] Remove @liteai/cli devDependency from packages/liteai/package.json
- [x] Remove @tui/* + @liteai/cli/* from packages/liteai/tsconfig.json
- [x] bun typecheck passes in both packages

### Phase 2 (Next Sprint)
- [ ] Add composite + declaration to liteai tsconfig
- [ ] Update liteai package.json exports with types condition
- [ ] Remove @/* from CLI tsconfig
- [ ] Add references to CLI tsconfig pointing at liteai
- [ ] Update Turbo pipeline ordering
- [ ] Verify CLI typecheck is fully isolated

### Phase 3 (Future)
- [ ] Rename "liteai" -> "@liteai/core"
- [ ] Update all liteai/ import specifiers workspace-wide
