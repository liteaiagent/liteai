import { NamedError } from "@liteai/util/error"
import { Effect, Layer, Record, ServiceMap, Struct } from "effect"
import z from "zod"
import * as Auth from "@/auth/service"
import { AUTH_PROVIDERS } from "../auth/registry"
import type { AuthHook, AuthOauthResult } from "../plugin/types"
import { ProviderID } from "./schema"

export const Prompt = z
  .union([
    z.object({
      type: z.literal("text"),
      key: z.string(),
      message: z.string(),
      placeholder: z.string().optional(),
    }),
    z.object({
      type: z.literal("select"),
      key: z.string(),
      message: z.string(),
      options: z.array(z.object({ label: z.string(), value: z.string(), hint: z.string().optional() })),
    }),
  ])
  .meta({ ref: "ProviderAuthPrompt" })
export type Prompt = z.infer<typeof Prompt>

export const Method = z
  .object({
    type: z.union([z.literal("oauth"), z.literal("api")]),
    label: z.string(),
    prompts: z.array(Prompt).optional(),
  })
  .meta({
    ref: "ProviderAuthMethod",
  })
export type Method = z.infer<typeof Method>

export const Authorization = z
  .object({
    url: z.string(),
    method: z.union([z.literal("auto"), z.literal("code")]),
    instructions: z.string(),
  })
  .meta({
    ref: "ProviderAuthAuthorization",
  })
export type Authorization = z.infer<typeof Authorization>

export const OauthMissing = NamedError.create(
  "ProviderAuthOauthMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCodeMissing = NamedError.create(
  "ProviderAuthOauthCodeMissing",
  z.object({
    providerID: ProviderID.zod,
  }),
)

export const OauthCallbackFailed = NamedError.create("ProviderAuthOauthCallbackFailed", z.object({}))

export type ProviderAuthError =
  | Auth.AuthServiceError
  | InstanceType<typeof OauthMissing>
  | InstanceType<typeof OauthCodeMissing>
  | InstanceType<typeof OauthCallbackFailed>

export namespace ProviderAuthService {
  export interface Service {
    /** Get available auth methods for each provider (e.g. OAuth, API key). */
    readonly methods: () => Effect.Effect<Record<string, Method[]>>

    /** Start an OAuth authorization flow for a provider. Returns the URL to redirect to. */
    readonly authorize: (input: {
      providerID: ProviderID
      method: number
      inputs?: Record<string, string>
    }) => Effect.Effect<Authorization | undefined>

    /** Complete an OAuth flow after the user has authorized. Exchanges the code/callback for credentials. */
    readonly callback: (input: {
      providerID: ProviderID
      method: number
      code?: string
    }) => Effect.Effect<void, ProviderAuthError>

    /** Set an API key directly for a provider (no OAuth flow). */
    readonly api: (input: { providerID: ProviderID; key: string }) => Effect.Effect<void, Auth.AuthServiceError>
  }
}

export class ProviderAuthService extends ServiceMap.Service<ProviderAuthService, ProviderAuthService.Service>()(
  "@liteai/ProviderAuth",
) {
  static readonly layer = Layer.effect(
    ProviderAuthService,
    Effect.gen(function* () {
      const auth = yield* Auth.AuthService

      // Build AuthHook-shaped map from global AUTH_PROVIDERS
      const registry = Object.fromEntries(
        [...AUTH_PROVIDERS.entries()].map(([id, p]) => [id, { provider: id, ...p.auth } as AuthHook]),
      )
      const pending = new Map<ProviderID, AuthOauthResult>()

      const methods = Effect.fn("ProviderAuthService.methods")(function* () {
        return Record.map(registry as Record<string, AuthHook>, (y: AuthHook) =>
          y.methods.map(
            (z): Method => ({
              ...Struct.pick(z, ["type", "label"]),
              prompts: z.prompts?.map((p) => {
                if (p.type === "select")
                  return { type: "select" as const, key: p.key, message: p.message, options: p.options }
                return { type: "text" as const, key: p.key, message: p.message, placeholder: p.placeholder }
              }),
            }),
          ),
        )
      })

      const authorize = Effect.fn("ProviderAuthService.authorize")(function* (input: {
        providerID: ProviderID
        method: number
        inputs?: Record<string, string>
      }) {
        const hook = (registry as Record<string, AuthHook>)[input.providerID]
        if (!hook) return
        const method = hook.methods[input.method]
        if (method.type !== "oauth") return
        const result: AuthOauthResult = yield* Effect.promise(() => method.authorize(input.inputs))
        pending.set(input.providerID, result)
        return {
          url: result.url,
          method: result.method,
          instructions: result.instructions,
        }
      })

      const callback = Effect.fn("ProviderAuthService.callback")(function* (input: {
        providerID: ProviderID
        method: number
        code?: string
      }) {
        const match = pending.get(input.providerID)
        if (!match) return yield* Effect.fail(new OauthMissing({ providerID: input.providerID }))

        if (match.method === "code" && !input.code)
          return yield* Effect.fail(new OauthCodeMissing({ providerID: input.providerID }))

        const result = yield* Effect.promise(() =>
          match.method === "code" ? match.callback(input.code as string) : match.callback(),
        )

        if (!result || result.type !== "success") return yield* Effect.fail(new OauthCallbackFailed({}))

        if ("key" in result) {
          yield* auth.set(input.providerID, {
            type: "api",
            key: result.key,
          })
        }

        if ("refresh" in result) {
          yield* auth.set(input.providerID, {
            type: "oauth",
            access: result.access,
            refresh: result.refresh,
            expires: result.expires,
            ...(result.accountId ? { accountId: result.accountId } : {}),
            ...(result.clientId ? { clientId: result.clientId } : {}),
            ...(result.clientSecret ? { clientSecret: result.clientSecret } : {}),
            ...(result.project ? { project: result.project } : {}),
          })
        }
      })

      const api = Effect.fn("ProviderAuthService.api")(function* (input: { providerID: ProviderID; key: string }) {
        yield* auth.set(input.providerID, {
          type: "api",
          key: input.key,
        })
      })

      return ProviderAuthService.of({
        methods,
        authorize,
        callback,
        api,
      })
    }),
  )

  static readonly defaultLayer = ProviderAuthService.layer.pipe(Layer.provide(Auth.AuthService.defaultLayer))
}
