# liteai

The core backend package for liteai — an AI coding agent for the terminal. This package contains the CLI, agent loop, provider integrations, and all server logic. It compiles into self-contained native binaries via Bun.

## Requirements

- [Bun](https://bun.sh) (see root `package.json` → `packageManager` for the required version)

## Install dependencies

From the repo root:

```bash
bun install
```

## Development

```bash
bun run dev
```

## Building

### Dev build — current platform only (fast, for local testing)

```bash
bun run build
```

Produces a native binary for your current OS/arch at:
```
dist/liteai-<os>-<arch>/bin/liteai[.exe]
```

You can run it directly:
```bash
./dist/liteai-linux-x64/bin/liteai --version
# Windows:
.\dist\liteai-windows-x64\bin\liteai.exe --version
```

### Build all platforms (needed before releasing)

```bash
bun run build:all
```

This builds **12 targets** across all platforms:

| Target | For |
|--------|-----|
| `liteai-linux-arm64` | Linux ARM64 (glibc) |
| `liteai-linux-x64` | Linux x64 (glibc, AVX2) |
| `liteai-linux-x64-baseline` | Linux x64 (glibc, no AVX2 — older CPUs) |
| `liteai-linux-arm64-musl` | Linux ARM64 (Alpine/musl) |
| `liteai-linux-x64-musl` | Linux x64 (Alpine/musl, AVX2) |
| `liteai-linux-x64-baseline-musl` | Linux x64 (Alpine/musl, no AVX2) |
| `liteai-darwin-arm64` | macOS Apple Silicon |
| `liteai-darwin-x64` | macOS Intel (AVX2) |
| `liteai-darwin-x64-baseline` | macOS Intel (no AVX2 — older Macs) |
| `liteai-windows-arm64` | Windows ARM64 |
| `liteai-windows-x64` | Windows x64 (AVX2) |
| `liteai-windows-x64-baseline` | Windows x64 (no AVX2 — older CPUs) |

The `bin/liteai` wrapper script (installed on PATH by npm) automatically detects which variant to run at runtime.

---

## Releasing

All release scripts default to:
- **bump**: `patch` (e.g. `1.2.26` → `1.2.27`)
- **channel**: `latest`
- **repo**: `liteaiagent/liteai`

No env vars needed for a standard patch release.

### Prerequisites

- **GitHub release**: [`gh`](https://cli.github.com/) CLI installed and authenticated (`gh auth login`)
- **npm publish**: logged in to npm (`npm login`)

---

### Release to GitHub only

Builds all platforms and uploads `.tar.gz` / `.zip` to GitHub Releases.
Users can download the binary directly from the releases page.

```bash
bun run release:gh
```

For a minor or major bump:
```bash
bun run release:gh -- --bump minor
bun run release:gh -- --bump major
```

---

### Release to npm only

Builds all platforms and publishes `liteai` + all platform packages to npm.
Users install with `npm install -g liteai`.

```bash
bun run release:npm
```

---

### Release to both GitHub and npm

```bash
bun run release
```

---

### Optional env var overrides

Only set these if you need to override the defaults:

| Variable | Default | Description |
|---|---|---|
| `LITEAI_VERSION` | auto-incremented from npm | Pin an exact version, e.g. `1.5.0` |
| `LITEAI_CHANNEL` | `latest` | Set to a branch name for preview releases |
| `LITEAI_BUMP` | `patch` | `patch`, `minor`, or `major` |
| `GH_REPO` | `liteaiagent/liteai` | Target GitHub repo for release uploads |

Example — release a specific version:
```bash
LITEAI_VERSION=2.0.0 bun run release
```


## Type checking

```bash
bun run typecheck
```

## Tests

```bash
bun test
```

> Tests must be run from this directory (`packages/core`), not the repo root.
