/**
 * JWT-based API key management for LiteAI.
 *
 * Port of liteai/api_keys.py
 * Uses jose instead of PyJWT.
 */

import * as jose from "jose"

const ISSUER = "liteai"
const ALGORITHM = "RS256"

// ── Types ──────────────────────────────────────────────────────────────────

export interface ApiKeyClaims {
  sub: string
  exp?: number
  iat: number
  iss: string
}

export class ApiKeyError extends Error {
  code: "invalid_api_key" | "expired_api_key" | "missing_api_key"
  constructor(message: string, code: "invalid_api_key" | "expired_api_key" | "missing_api_key" = "invalid_api_key") {
    super(message)
    this.name = "ApiKeyError"
    this.code = code
  }
}

// ── Key Verification ───────────────────────────────────────────────────────

export async function verifyApiKey(publicKeyPem: string, token: string): Promise<ApiKeyClaims> {
  try {
    const publicKey = await jose.importSPKI(publicKeyPem, ALGORITHM)
    const { payload } = await jose.jwtVerify(token, publicKey, {
      issuer: ISSUER,
      requiredClaims: ["sub", "iat", "iss"],
    })
    return {
      sub: payload.sub as string,
      exp: payload.exp,
      iat: payload.iat as number,
      iss: payload.iss as string,
    }
  } catch (err) {
    if (err instanceof jose.errors.JWTExpired) {
      throw new ApiKeyError("API key has expired. Please request a new key.", "expired_api_key")
    }
    throw new ApiKeyError(`Invalid API key: ${err instanceof Error ? err.message : String(err)}`, "invalid_api_key")
  }
}

export function decodeApiKeyUnsafe(token: string): ApiKeyClaims | null {
  try {
    const payload = jose.decodeJwt(token)
    return {
      sub: payload.sub as string,
      exp: payload.exp,
      iat: payload.iat as number,
      iss: payload.iss as string,
    }
  } catch {
    return null
  }
}
