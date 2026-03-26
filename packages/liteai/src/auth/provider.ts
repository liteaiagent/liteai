import type { AuthHook, Hooks } from "../plugin/types"

export interface AuthProvider {
  provider: string

  /** One-time setup at daemon boot (replaces `let cached` hacks) */
  setup?(): Promise<void>

  /** Same shape as AuthHook minus `provider` — reused as-is */
  auth: Omit<AuthHook, "provider">

  /** Optional non-auth hooks this provider contributes (e.g. chat.headers) */
  hooks?: Partial<Pick<Hooks, "chat.headers">>
}
