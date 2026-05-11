---
title: CLI reference
description: "Command-line interface flags, commands, and exit codes for LiteAI."
---

# CLI reference

## Usage

```bash
liteai [options] [prompt]
```

## Options

| Flag | Description | Default |
|---|---|---|
| `--port <n>` | HTTP server port | 3000 |
| `--host <addr>` | Bind address | localhost |
| `--model <name>` | Override model | From config |
| `--provider <name>` | Override provider | From config |
| `--headless` | Non-interactive mode | false |
| `--message <text>` | Initial prompt (headless) | — |
| `--output <file>` | Output file (headless) | stdout |
| `--permission <mode>` | Permission mode | default |
| `--coordinator` | Enable coordinator mode | false |
| `--version` | Print version | — |
| `--help` | Print help | — |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Provider authentication failure |
| 4 | Port already in use |
