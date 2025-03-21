# Shell Tool (Bash)

How the LLM executes shell commands, the runtime lifecycle of each invocation, and how
output streams to the frontend.

---

## 1. Architecture Overview

The `bash` tool lets the LLM run arbitrary shell commands. Despite the name, it adapts to
the host platform — it is not limited to Bash.

```
┌───────────┐   tool call    ┌─────────────┐   spawn()    ┌───────────┐
│           │ ──────────────→│             │ ────────────→│  Shell    │
│   LLM     │                │  bash.ts    │              │  Process  │
│           │←────────────── │             │←──────────── │  (child)  │
└───────────┘   tool result  └──────┬──────┘   exit code  └───────────┘
                                    │
                              ctx.metadata()
                                    │
                              ┌─────▼──────┐
                              │   SSE      │
                              │   Events   │
                              └────────────┘
```

Key design decisions:
- **No PTY** — commands are spawned via `child_process.spawn()` with `stdio: ["ignore", "pipe", "pipe"]`. There is no pseudo-terminal. This means interactive commands (vi, less, top, etc.) will not work.
- **No idle/wait detection** — the tool does not monitor for idle periods or attempt to detect interactive prompts. It simply waits for the process to exit or timeout.
- **Fire-and-forget** — the LLM sends a command, waits for completion (or timeout), and receives the full output. There is no back-and-forth interaction with the running process.

---

## 2. Shell Selection

The shell is selected once at tool initialization via `Shell.acceptable()`. The logic is
platform-aware.

### 2.1 Selection algorithm

```
Is $SHELL set and not blacklisted?
  ├── yes → use $SHELL
  └── no → use platform fallback
```

**Blacklisted shells:** `fish`, `nu` (these have incompatible syntax for the command
strings the LLM generates).

### 2.2 Platform fallbacks

| Platform | Fallback chain |
|---|---|
| **Windows** | 1. `$LITEAI_GIT_BASH_PATH` (if set) → 2. Git Bash auto-detect¹ → 3. `%COMSPEC%` → 4. `cmd.exe` |
| **macOS** | `/bin/zsh` |
| **Linux** | 1. `bash` (via `which`) → 2. `/bin/sh` |

¹ Git Bash auto-detection: if `git.exe` is on PATH (e.g. `C:\Program Files\Git\cmd\git.exe`),
the tool resolves `..\..\bin\bash.exe` relative to it.

### 2.3 Why Git Bash on Windows?

The LLM generates Bash-style commands (pipes, `&&` chains, quoting). Git Bash provides a
POSIX-like shell on Windows, so the same commands work cross-platform. If Git Bash is not
available, the tool falls back to `cmd.exe`.

---

## 3. Command Execution Lifecycle

### 3.1 Permission checking (tree-sitter parsing)

Before spawning, the command string is **parsed using tree-sitter** with the Bash grammar.
This extracts:

1. **Command names and arguments** — each `command` AST node is walked to extract the
   executable name and its arguments.
2. **External directory access** — commands like `cd`, `rm`, `cp`, `mv`, `mkdir`, etc. have
   their path arguments resolved. If any path falls outside the project root, an
   `external_directory` permission prompt is raised.
3. **Bash command patterns** — each unique command text is collected for `bash` permission
   evaluation against the agent's permission ruleset.

### 3.2 Process spawning

```typescript
spawn(params.command, {
  shell,               // the selected shell (see §2)
  cwd,                 // Instance.directory or params.workdir
  env: { ...process.env, ...pluginEnv },
  stdio: ["ignore", "pipe", "pipe"],  // stdin closed, stdout/stderr piped
  detached: process.platform !== "win32",
  windowsHide: true,   // (Windows only) hide the console window
})
```

- **stdin is ignored** — the process cannot receive interactive input. This is intentional:
  the LLM cannot interact with prompts, so commands like `git rebase -i` or `ssh` password
  prompts will hang until timeout.
- **detached** — on Unix, the process is spawned in a new process group (for clean
  `killTree` via negative PID). On Windows, `taskkill /f /t` is used instead.

### 3.3 Output streaming

Both `stdout` and `stderr` are merged into a single `output` string. As data arrives, the
tool calls `ctx.metadata()` to push incremental updates:

```typescript
proc.stdout?.on("data", (chunk) => {
  output += chunk.toString()
  ctx.metadata({
    metadata: {
      output: output.slice(0, 30_000),  // capped for SSE
      description: params.description,
    },
  })
})
```

This metadata callback is the mechanism by which **live command output reaches the frontend**
via SSE. Each `ctx.metadata()` call publishes a bus event that the SSE stream picks up,
allowing the UI to show a real-time output preview while the command runs.

> **Metadata truncation vs output truncation**: The metadata sent via SSE is capped at
> 30,000 characters (for transport efficiency). The *full* output is kept in memory and
> returned to the LLM. If the full output exceeds 2,000 lines or 50 KB, it is written to a
> file on disk and the LLM receives a truncated preview with a path to the full output.

### 3.4 Timeout & abort

| Mechanism | Default | Source | Behavior |
|---|---|---|---|
| **Timeout** | 120,000 ms (2 min) | [`src/tool/bash.ts:22`](file:///src/tool/bash.ts#L22) | Configurable per-call via `timeout` parameter. After expiry, the process tree is killed. |
| **User abort** | — | — | If the user interrupts the session (Escape in TUI), the abort signal fires and the process tree is killed. |
| **Global override** | — | `$LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Env var to change the 2-minute default for all calls. |

The timeout default is defined in `src/tool/bash.ts`:

```typescript
const DEFAULT_TIMEOUT = Flag.LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || 2 * 60 * 1000
```

The LLM can also override the timeout per-call via the `timeout` parameter in its tool
call JSON. Negative values are rejected.

### 3.5 Output tagging on timeout/abort

When a command is killed by timeout or user abort, a `<bash_metadata>` XML tag is appended
to the output before returning it to the LLM:

```
<bash_metadata>
bash tool terminated command after exceeding timeout 120000 ms
</bash_metadata>
```

This lets the LLM know the command did not complete normally and decide how to proceed
(e.g. retry with a longer timeout, or try a different approach).

### 3.6 Process tree killing

| Platform | Kill method | Source |
|---|---|---|
| **Unix** | `SIGTERM` to process group (`-pid`), wait 200ms, then `SIGKILL` if still alive | [`src/shell/shell.ts`](file:///src/shell/shell.ts) |
| **Windows** | `taskkill /pid <pid> /f /t` (force kill entire process tree) | [`src/shell/shell.ts`](file:///src/shell/shell.ts) |

### 3.7 Plugin hook

Before spawning, the `shell.env` plugin hook fires, allowing plugins to inject environment
variables:

```typescript
const shellEnv = await Plugin.trigger("shell.env", {
  cwd,
  sessionID: ctx.sessionID,
  callID: ctx.callID,
}, { env: {} })
```

---

## 4. Output Handling & Truncation

| Threshold | Value |
|---|---|
| Max lines before truncation | 2,000 |
| Max bytes before truncation | 50 KB |

When output exceeds either limit:

1. The full output is saved to `~/.local/share/liteai/tool-output/<id>`.
2. The LLM receives only the first 2,000 lines (or 50 KB) plus a hint:  
   *"Full output saved to `<path>`. Use Grep to search or Read with offset/limit."*
3. Saved files are cleaned up after 7 days by a scheduled task.

---

## 5. SSE Event Flow

When the bash tool executes, the frontend receives a stream of SSE events showing the
tool's progress:

```
1. session.message.part.updated   ← tool call starts (status: "running")
   metadata: { output: "", description: "Runs npm test" }

2. session.message.part.updated   ← stdout/stderr chunk arrives
   metadata: { output: "PASS src/...", description: "Runs npm test" }

3. session.message.part.updated   ← more output chunks
   metadata: { output: "PASS src/...\n...", description: "..." }

4. session.message.part.updated   ← tool completes (status: "completed")
   metadata: { output: "...", exit: 0, description: "..." }
```

The frontend (TUI or web UI) renders these incremental metadata updates to show live command
output. The `description` field (provided by the LLM) is used as the tool call's title in
the UI.

---

## 6. Interactive Command Handling

### 6.1 No runtime interactive detection

LiteAI does **not** detect at runtime whether a command is interactive. There is no idle
timer, no stdin-waiting heuristic, and no mechanism to send input to a running process.

The avoidance of interactive commands is enforced purely through the **LLM system prompt**
(`src/tool/bash.txt`). The prompt tells the LLM:

> *"Never use git commands with the `-i` flag (like `git rebase -i` or `git add -i`) since
> they require interactive input which is not supported."*

If the LLM ignores this instruction and runs an interactive command, the command will
hang with stdin closed until the 2-minute timeout fires, at which point the process tree
is killed and the `<bash_metadata>` tag informs the LLM of the timeout.

### 6.2 Limitations (no PTY)

Because the tool uses piped stdio (not a PTY), several things are not possible:

| Limitation | Reason |
|---|---|
| Interactive prompts (`y/n`, passwords) | stdin is closed (`"ignore"`) |
| Terminal UI programs (vim, top, less) | No PTY allocation, no terminal emulation |
| Colored/formatted output detection | No TTY — programs typically disable colors |
| Real-time interaction mid-command | No mechanism to send input after spawn |
| Background job control (`bg`, `fg`) | No job control without a PTY |

### 6.3 Workarounds the LLM uses

Instead of interactive commands, the LLM is trained to use non-interactive equivalents:

| Interactive | Non-interactive alternative |
|---|---|
| `git rebase -i` | `git rebase` (non-interactive) |
| `npm init` | `npm init -y` |
| `rm -i file` | `rm file` (after permission check) |
| `ssh` (password) | Key-based auth or `ssh-agent` |
| `less file` | Use the dedicated Read tool instead |

---

## 7. Configuration Summary

| Setting | Location | Description |
|---|---|---|
| Default timeout | `$LITEAI_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS` | Override the 2-minute default |
| Git Bash path (Windows) | `$LITEAI_GIT_BASH_PATH` | Explicit path to `bash.exe` |
| Shell override | `$SHELL` | Standard Unix shell variable (respected unless blacklisted) |
| Permission rules | `liteai.json` → `permission.bash` | Allow/deny/ask rules for command patterns |
| Plugin env vars | `shell.env` plugin hook | Inject env vars into spawned processes |

---

## 8. Design Consideration: PTY Migration

### 8.1 Why PTY?

The current piped stdio approach prevents the LLM from interacting with commands that
expect a terminal. A PTY would enable:
- Interactive prompts (y/n confirmations, password input)
- Richer output (colors, progress bars, spinners — programs auto-detect TTY)
- Potential for LLM-driven interaction with long-running processes

### 8.2 Proposed approach: client selects mode

The backend should **not** know or care which client is connected. Instead, it offers
both spawn modes and the **client selects** which one it wants — for example via a
session-level or connection-level capability:

```
Client connects (SSE / session create)
  │
  ├── capabilities: { pty: true }   → backend spawns with PTY
  └── capabilities: { pty: false }  → backend spawns with piped stdio (current)
```

This keeps the backend client-agnostic. Each client declares what it can handle:

| Client | Declares | Why |
|---|---|---|
| **Web app** | `pty: true` | Can render PTY output via xterm.js |
| **TUI** | `pty: false` | Cannot host a PTY (terminal conflict) |
| **SDK** | Either | Consumer decides based on their use case |

The bash tool internally checks the session/connection capability flag and chooses
the spawn strategy accordingly. The tool's parameters, permissions, and output format
stay identical — only the plumbing changes.

### 8.3 Why the TUI opts out of PTY

The TUI is a full-screen terminal application (Ink/React) that owns the terminal:
- **Raw mode** for keystroke capture
- **Alternate screen buffer** for the UI layout
- **Mouse capture** for scrolling

A PTY child would conflict because both the TUI and the child process expect to control
the terminal. Approaches like "suspend & resume" (à la Vim's `:!command`) or embedding
a terminal emulator widget exist but add significant complexity. So the TUI would
simply declare `pty: false` and keep using piped stdio.

The web app has no such conflict — it communicates via SSE/HTTP, so PTY output can be
rendered in an embedded terminal widget (e.g. xterm.js) without interfering with anything.

### 8.4 What changes for each client

| Client | Current | After PTY migration |
|---|---|---|
| **Web app** | Piped stdio, plain text via SSE | Declares `pty: true`, gets colors/formatting via xterm.js |
| **TUI** | Piped stdio, plain text in panel | Declares `pty: false`, **no change** |
| **SDK** | Piped stdio, raw text in API | Chooses per use case |
