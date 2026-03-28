/**
 * OpenAI-compatible error response types.
 *
 * Port of liteai/models/errors.py
 */

export interface ErrorDetail {
  message: string
  type: string
  param?: string | null
  code?: string | null
}

export interface ErrorResponse {
  error: ErrorDetail
}

export function createErrorResponse(
  message: string,
  type: string,
  code?: string | null,
  param?: string | null,
): ErrorResponse {
  return {
    error: {
      message,
      type,
      param: param ?? null,
      code: code ?? null,
    },
  }
}
