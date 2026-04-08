### 1. `run_command` (Launch & Await)
This is the entry point. When I run a command, I provide:
- **`CommandLine`**: The exact string to run (in PowerShell).
- **`Cwd`**: The strict working directory. *Optimization:* I never need to run `cd x && run y` because I can execute directly in any directory.
- **`SafeToAutoRun`**: A boolean flag. If `true`, the command executes immediately without pausing for you to click "Approve." *Optimization:* I am required to set this to `false` for anything destructive/mutating. However, for read-only actions, safe build checks, or if you use the `// turbo-all` directive in a workflow file, I can set it to `true` to blaze through steps without interrupting you. 
- **`WaitMsBeforeAsync` (Max: 10,000ms / 10s)**: The time I will synchronously wait for the command to finish. *Optimization:* If I know `bun typecheck` takes 2 minutes, I should not max this out to 10s and block my own process loop. Instead, I should set it low (e.g., `500ms`) to immediately background the command and retrieve a `CommandId`.

### 2. `command_status` (Monitor & Ingest - High Value for Heavy Loads)
If a command gets backgrounded, I use this tool to monitor it.
- **`CommandId`**: The ID returned from `run_command`.
- **`WaitDurationSeconds` (Max: 300s / 5m)**: I can instruct the tool to wait up to 5 minutes for the command to finish *before* it replies to me. *Optimization:* This is massively efficient for heavy tasks like `bun test` or `bun typecheck`. Instead of aggressively polling every 5 seconds, I can just tell the system "wake me up in 5 minutes or when it finishes."
- **`OutputCharacterCount`**: As we discussed, I can specify exactly how much of the buffer I want to ingest into my context window. *Optimization:* If I only care *that* a build succeeded (exit code), I can pull `1000` chars. If I need the full stack trace of a failed typecheck, I can crank this up to capture the whole stream.

### 3. `send_command_input` (Interact & Terminate)
For long-running servers or REPLs.
- **`Input` or `Terminate`**: I can type streams of text into `stdin` or explicitly kill the process. *Optimization:* Interactive CLI wizards are usually slow for agents because of the round-trip latency. It is almost always better to pass flags (e.g., `bun create my-app --yes --no-interactive`) than for me to try and respond to terminal prompts one by one using this tool.

### How this affects our Core Mandates
Based on this toolkit, here are a few ways we can optimize your rules (like the mandate on `typecheck`):
1. **Piping for streams is safe but maybe unnecessary:** Because I can use `OutputCharacterCount` natively via `command_status`, PowerShell pipeline merges (e.g., `2>&1 | Out-String`) are somewhat optional, but functionally fine to ensure we never hit standard error buffer limits in raw PS.
2. **"No interactive workflows":** We should explicitly instruct the use of `-y` or strict CLI flags wherever possible to avoid the slow latency of the `send_command_input` tool.
3. **Patience via `WaitDurationSeconds`:** The best way for me to execute long typechecks or tests is to background them immediately, then run `command_status` with `WaitDurationSeconds` set to max. I will just "sleep" until the result is ready, ensuring no timeout errors on my end.