# Build Script (`script/build.ts`)

The build script produces **standalone, self-contained binaries** for every supported OS/architecture combination using Bun's single-file compilation (`Bun.build` with `compile: true`). A single run of `pnpm build` (or `bun run script/build.ts`) emits **12 binaries** under `dist/`.

## Pipeline Overview

```
┌──────────────────────────────────────────────────┐
│  1. Environment & versioning  (@liteai/script)
│  2. Fetch models snapshot     (models.dev API)
│  3. Load SQL migrations       (migration/**/migration.sql)
│  4. Install native deps       (cross-platform npm binaries)
│  5. Compile per-target         (Bun.build for each target)
│  6. Package for release        (tar.gz / zip → GitHub Release)
└──────────────────────────────────────────────────┘
```

## Step-by-Step

### 1. Version & Channel Resolution (`script/script.ts`)

The shared `Script` object (from `packages/script`) determines:

| Property  | Source                                                                                   |
| --------- | ---------------------------------------------------------------------------------------- |
| `channel` | `LITEAI_CHANNEL` env var, or current git branch name                                   |
| `version` | `LITEAI_VERSION` env var, or for preview builds `0.0.0-<branch>-<YYYYMMDDHHmm>`, or auto-bumped from latest npm release |
| `preview` | `true` when channel ≠ `"latest"`                                                         |
| `release` | `true` when `LITEAI_RELEASE` is set (CI only)                                          |

For a local build from a feature branch (e.g. `liteai`), you get a preview version like `0.0.0-liteai-202603141409`.

### 2. Models Snapshot

Fetches the model catalog from `https://models.dev/api.json` (or a local file via `MODELS_DEV_API_JSON`) and writes it as a TypeScript `const` export to `src/provider/models-snapshot.ts`. This embeds the catalog directly into the binary.

### 3. Migrations

Reads every `migration/<timestamp_slug>/migration.sql` directory, extracts the SQL content and a UTC timestamp from the directory name, and stores them as a JSON array. These are injected as a compile-time `define` (`LITEAI_MIGRATIONS`) so the binary can run migrations without reading from disk at runtime.

### 4. Cross-Platform Native Dependency Install

Before compiling, the script installs **all platform variants** of two native packages:

```bash
bun install --os="*" --cpu="*" @opentui/core@<version>
bun install --os="*" --cpu="*" @parcel/watcher@<version>
```

The `--os="*" --cpu="*"` flags tell Bun/npm to download every OS+CPU optional dependency (the platform-specific `.node` addons). This is what produces the "Resolving dependencies / downloaded and extracted [45]" output you see — it is downloading the native binaries for linux, darwin, and win32 so cross-compilation can bundle them.

These packages have platform-specific optional dependencies listed in `devDependencies`:

- `@parcel/watcher-darwin-arm64`, `@parcel/watcher-darwin-x64`
- `@parcel/watcher-linux-arm64-glibc`, `@parcel/watcher-linux-arm64-musl`, `@parcel/watcher-linux-x64-glibc`, `@parcel/watcher-linux-x64-musl`
- `@parcel/watcher-win32-arm64`, `@parcel/watcher-win32-x64`

Skip this step with `--skip-install`.

### 5. Target Matrix & Compilation

The script defines **12 targets** across 3 operating systems, 2 architectures, optional musl ABI (Linux), and an AVX2 baseline variant:

| OS       | Arch    | Notes                              | Binary name                         |
| -------- | ------- | ---------------------------------- | ----------------------------------- |
| `linux`  | `arm64` |                                    | `liteai-linux-arm64`                |
| `linux`  | `x64`   |                                    | `liteai-linux-x64`                  |
| `linux`  | `x64`   | `avx2: false` — older CPUs         | `liteai-linux-x64-baseline`         |
| `linux`  | `arm64` | `abi: musl` — Alpine / musl libc   | `liteai-linux-arm64-musl`           |
| `linux`  | `x64`   | `abi: musl`                        | `liteai-linux-x64-musl`             |
| `linux`  | `x64`   | `abi: musl`, `avx2: false`         | `liteai-linux-x64-baseline-musl`    |
| `darwin` | `arm64` | macOS Apple Silicon                | `liteai-darwin-arm64`               |
| `darwin` | `x64`   | macOS Intel                        | `liteai-darwin-x64`                 |
| `darwin` | `x64`   | `avx2: false`                      | `liteai-darwin-x64-baseline`        |
| `win32`  | `arm64` | Windows ARM                        | `liteai-windows-arm64`              |
| `win32`  | `x64`   | Windows x64                        | `liteai-windows-x64`                |
| `win32`  | `x64`   | `avx2: false` — older x64 CPUs     | `liteai-windows-x64-baseline`       |

> **Note:** The output name uses `windows` instead of `win32` (npm reserves `win32` as a flag).

#### `--single` flag

Filters the matrix down to just the current host platform+ architecture. Useful for fast local development builds. If combined with `--baseline`, includes the baseline variant too.

#### Compilation (`Bun.build`)

Each target is compiled via `Bun.build()` with `compile: true`:

```ts
await Bun.build({
  conditions: ["browser"],
  compile: {
    target: "bun-windows-x64",           // derived from target name
    outfile: "dist/liteai-windows-x64/bin/liteai",
    execArgv: ["--user-agent=liteai/<version>", "--use-system-ca", "--"],
  },
  entrypoints: ["./src/index.ts", parserWorker, workerPath],
  define: {
    LITEAI_VERSION:      "'<version>'",
    LITEAI_MIGRATIONS:   '<json>',
    LITEAI_CHANNEL:      "'<channel>'",
    LITEAI_WORKER_PATH:  '<path>',
    LITEAI_LIBC:         "'glibc'",     // linux only
    OTUI_TREE_SITTER_WORKER_PATH: '<bunfs-path>',
  },
})
```

Key details:

- **`compile.target`**: Tells Bun which runtime to bundle (e.g. `bun-windows-x64`). This is how cross-compilation works — you can build a Windows binary from a macOS or Linux host.
- **`bunfs` root**: Windows uses `B:/~BUN/root/` as the virtual filesystem path for embedded files, while Linux/macOS use `/$bunfs/root/`.
- **`execArgv`**: Bakes in startup flags — sets a user-agent string and enables system CA certificates.
- **`define`**: Compile-time constants that replace identifiers at build time, embedding version info, migrations, and worker paths directly into the binary.

Each target gets its own `dist/<name>/package.json` with `os` and `cpu` fields for npm's optional dependency resolution.

### 6. Release Packaging

When `LITEAI_RELEASE` is set (CI), the script packages and uploads:

| Platform | Format    | Upload                                              |
| -------- | --------- | --------------------------------------------------- |
| Linux    | `.tar.gz` | `gh release upload v<version> ./dist/*.tar.gz`      |
| **Windows** | **`.zip`** | **`gh release upload v<version> ./dist/*.zip`** |
| macOS    | `.zip`    | `gh release upload v<version> ./dist/*.zip`         |

Windows and macOS binaries are zipped; Linux binaries are tar-gzipped.

## Windows-Specific Details

1. **Three Windows targets** are produced: `arm64`, `x64`, and `x64-baseline` (no AVX2 requirement).
2. The binary output is `dist/liteai-windows-<arch>/bin/liteai` (Bun appends `.exe` automatically on Windows targets).
3. The `bunfs` virtual filesystem root is `B:/~BUN/root/` (a Bun-specific Windows convention for embedded files).
4. The `LITEAI_LIBC` define is set to an empty string for Windows (only meaningful on Linux for glibc vs musl).
5. Release archives use `.zip` format (not `.tar.gz`).

## npm Publishing (`script/publish.ts`)

> **Prerequisite:** You must be authenticated with npm (`npm login`) before running the publish script.

After building, `publish.ts` publishes each binary as a separate npm package (e.g. `liteai-windows-x64`) and a wrapper package `liteai` that lists all binaries as `optionalDependencies`. This lets `npm install -g liteai` download only the correct binary for the user's platform via npm's `os`/`cpu` filtering.

The publish step also generates:
- **Arch Linux AUR** PKGBUILD for `liteai-bin`
- **Homebrew** formula for `liteai` (macOS and Linux)
- **Docker** multi-platform images (linux/amd64, linux/arm64)

## CLI Flags Summary

| Flag              | Effect                                                     |
| ----------------- | ---------------------------------------------------------- |
| `--single`        | Build only for the current host OS/arch                    |
| `--baseline`      | Include the baseline (no AVX2) variant with `--single`     |
| `--skip-install`  | Skip the cross-platform native dependency install step     |

## Environment Variables

| Variable              | Effect                                                           |
| --------------------- | ---------------------------------------------------------------- |
| `LITEAI_CHANNEL`      | Override the release channel (default: git branch name)          |
| `LITEAI_VERSION`      | Override the version string                                      |
| `LITEAI_BUMP`         | Auto-bump type: `major`, `minor`, or `patch`                     |
| `LITEAI_RELEASE`      | Enable release packaging (zip/tar.gz + GitHub upload)            |
| `LITEAI_MODELS_URL`   | Override models API base URL (default: `https://models.dev`)     |
| `MODELS_DEV_API_JSON` | Path to a local models JSON file (skips HTTP fetch)              |
