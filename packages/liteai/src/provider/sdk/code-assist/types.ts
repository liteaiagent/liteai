// Code Assist API types — subset ported from gemini-cli/packages/core/src/code_assist/types.ts
// Only types needed for generateContent / streamGenerateContent are included.

export interface ClientMetadata {
  ideType?: string
  ideVersion?: string
  pluginVersion?: string
  platform?: string
  updateChannel?: string
  duetProject?: string
  pluginType?: string
  ideName?: string
}

export const UserTierId = {
  FREE: "free-tier",
  LEGACY: "legacy-tier",
  STANDARD: "standard-tier",
  PLUS: "plus-tier",
  PRO: "pro-tier",
  ULTRA: "ultra-tier",
} as const
export type UserTierId = (typeof UserTierId)[keyof typeof UserTierId] | string

export interface GeminiUserTier {
  id?: UserTierId
  name?: string
  description?: string
  userDefinedCloudaicompanionProject?: boolean | null
  isDefault?: boolean
  hasAcceptedTos?: boolean
  hasOnboardedPreviously?: boolean
}

export interface LoadCodeAssistRequest {
  cloudaicompanionProject?: string
  metadata: ClientMetadata
  mode?: string
}

export interface LoadCodeAssistResponse {
  currentTier?: GeminiUserTier | null
  allowedTiers?: GeminiUserTier[] | null
  ineligibleTiers?: IneligibleTier[] | null
  cloudaicompanionProject?: string | null
  paidTier?: GeminiUserTier | null
}

export interface IneligibleTier {
  reasonCode?: IneligibleTierReasonCode
  reasonMessage?: string
  tierId?: UserTierId
  tierName?: string
  validationErrorMessage?: string
  validationUrl?: string
  validationUrlLinkText?: string
  validationLearnMoreUrl?: string
  validationLearnMoreLinkText?: string
}

export enum IneligibleTierReasonCode {
  DASHER_USER = "DASHER_USER",
  INELIGIBLE_ACCOUNT = "INELIGIBLE_ACCOUNT",
  NON_USER_ACCOUNT = "NON_USER_ACCOUNT",
  RESTRICTED_AGE = "RESTRICTED_AGE",
  RESTRICTED_NETWORK = "RESTRICTED_NETWORK",
  UNKNOWN = "UNKNOWN",
  UNKNOWN_LOCATION = "UNKNOWN_LOCATION",
  UNSUPPORTED_LOCATION = "UNSUPPORTED_LOCATION",
  VALIDATION_REQUIRED = "VALIDATION_REQUIRED",
}

export interface OnboardUserRequest {
  tierId: string | undefined
  cloudaicompanionProject: string | undefined
  metadata: ClientMetadata | undefined
}

export interface LongRunningOperationResponse {
  name?: string
  done?: boolean
  response?: {
    cloudaicompanionProject?: { id?: string; name?: string }
  }
}

// ── Credits ──────────────────────────────────────────────────────────

export type CreditType = "CREDIT_TYPE_UNSPECIFIED" | "GOOGLE_ONE_AI"

export interface Credits {
  creditType: CreditType
  creditAmount: string // int64 as string in JSON
}

export const G1_CREDIT_TYPE = "GOOGLE_ONE_AI"

// ── Generate Content envelope ────────────────────────────────────────

export interface CAGenerateContentRequest {
  model: string
  project?: string
  user_prompt_id?: string
  request: VertexGenerateContentRequest
  enabled_credit_types?: string[]
}

export interface VertexGenerateContentRequest {
  contents: Array<{ role: string; parts: CAPart[] }> // array of turns, each is { role, parts }
  systemInstruction?: { role: string; parts: CAPart[] }
  tools?: CAToolDeclaration[]
  toolConfig?: CAToolConfig
  generationConfig?: CAGenerationConfig
  session_id?: string
}

export interface CAGenerationConfig {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  stopSequences?: string[]
  responseMimeType?: string
  responseSchema?: unknown
  thinkingConfig?: { includeThoughts?: boolean; thinkingBudget?: number }
}

export interface CAToolDeclaration {
  functionDeclarations?: CAFunctionDeclaration[]
  googleSearch?: Record<string, never>
}

export interface CAFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface CAToolConfig {
  functionCallingConfig?: {
    mode?: string
    allowedFunctionNames?: string[]
  }
}

// ── Parts ────────────────────────────────────────────────────────────

export interface CAPart {
  text?: string
  thought?: boolean
  thoughtSignature?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  inlineData?: { mimeType: string; data: string }
  fileData?: { mimeType: string; fileUri: string }
}

// ── Generate Content response ────────────────────────────────────────

export interface CAGenerateContentResponse {
  response?: VertexGenerateContentResponse
  traceId?: string
  consumedCredits?: Credits[]
  remainingCredits?: Credits[]
}

export interface VertexGenerateContentResponse {
  candidates?: CACandidate[]
  usageMetadata?: CAUsageMetadata
  modelVersion?: string
}

export interface CACandidate {
  content?: { role?: string; parts?: CAPart[] }
  finishReason?: string
  groundingMetadata?: CAGroundingMetadata
}

export interface CAGroundingMetadata {
  groundingChunks?: CAGroundingChunk[]
  groundingSupports?: CAGroundingSupport[]
}

export interface CAGroundingChunk {
  web?: { uri?: string; title?: string }
}

export interface CAGroundingSupport {
  segment?: { startIndex: number; endIndex: number; text?: string }
  groundingChunkIndices?: number[]
  confidenceScores?: number[]
}

export interface CAUsageMetadata {
  promptTokenCount?: number
  candidatesTokenCount?: number
  totalTokenCount?: number
  thoughtsTokenCount?: number
}
