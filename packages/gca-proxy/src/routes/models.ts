/**
 * Models route — GET /v1/models, GET /v1/models/:id
 *
 * Port of liteai/api/routes/models_route.py
 */

import { Hono } from "hono"
import { MODEL_ALIASES, resolveModel, VALID_GEMINI_MODELS } from "../core/model-config.js"
import { createErrorResponse } from "../models/errors.js"

const models = new Hono()

// Build AVAILABLE_MODELS (sorted for stable order)
const AVAILABLE_MODELS = [...VALID_GEMINI_MODELS].sort().map((id) => ({
  id,
  object: "model" as const,
  created: 0,
  owned_by: "google",
}))

models.get("/models", (c) => c.json({ object: "list", data: AVAILABLE_MODELS }))

models.get("/models/", (c) => c.json({ object: "list", data: AVAILABLE_MODELS }))

models.get("/models/:modelId", (c) => {
  const modelId = c.req.param("modelId")
  const resolvedId = MODEL_ALIASES.has(modelId) ? resolveModel(modelId) : modelId

  const model = AVAILABLE_MODELS.find((m) => m.id === resolvedId)
  if (!model) {
    return c.json(
      createErrorResponse(`The model '${modelId}' does not exist`, "invalid_request_error", "model_not_found"),
      404,
    )
  }
  return c.json(model)
})

export { models }
