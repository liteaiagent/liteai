import type { AuthClient } from "google-auth-library"
import z from "zod"
import DESCRIPTION from "../bundled/prompts/tools/websearch.txt"
import { Provider } from "../provider/provider"
import { ProviderID } from "../provider/schema"
import type { CodeAssistClientConfig } from "../provider/sdk/code-assist"
import { codeAssistSearch } from "../provider/sdk/code-assist"
import { abortAfterAny } from "../util/abort"
import { Tool } from "./tool"

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
} as const

interface McpSearchRequest {
  jsonrpc: string
  id: number
  method: string
  params: {
    name: string
    arguments: {
      query: string
      numResults?: number
      livecrawl?: "fallback" | "preferred"
      type?: "auto" | "fast" | "deep"
      contextMaxCharacters?: number
    }
  }
}

interface McpSearchResponse {
  jsonrpc: string
  result: {
    content: Array<{
      type: string
      text: string
    }>
  }
}

export const WebSearchTool = Tool.define("websearch", async () => {
  return {
    get description() {
      return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
    },
    parameters: z.object({
      query: z.string().describe("Websearch query"),
      numResults: z.number().optional().describe("Number of search results to return (default: 8)"),
      livecrawl: z
        .enum(["fallback", "preferred"])
        .optional()
        .describe(
          "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
        ),
      type: z
        .enum(["auto", "fast", "deep"])
        .optional()
        .describe(
          "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
        ),
      contextMaxCharacters: z
        .number()
        .optional()
        .describe("Maximum characters for context string optimized for LLMs (default: 10000)"),
    }),
    async execute(params, ctx) {
      await ctx.ask({
        permission: "websearch",
        patterns: [params.query],
        always: ["*"],
        metadata: {
          query: params.query,
          numResults: params.numResults,
          livecrawl: params.livecrawl,
          type: params.type,
          contextMaxCharacters: params.contextMaxCharacters,
        },
      })

      const model = ctx.extra?.model as Provider.Model | undefined
      if (model?.providerID === ProviderID.googleCodeAssist) {
        return searchViaCodeAssist(params.query, model, ctx.abort)
      }

      return searchViaExa(params, ctx.abort)
    },
  }
})

async function searchViaCodeAssist(query: string, model: Provider.Model, abort: AbortSignal) {
  const provider = await Provider.getProvider(model.providerID)
  const client = provider?.options?.client as AuthClient | undefined
  if (!client) throw new Error("Code Assist search requires an authenticated client")
  const cfg: CodeAssistClientConfig = {
    client,
    endpoint: provider?.options?.baseURL as string | undefined,
    httpOptions: {
      headers: {
        ...(provider?.options?.headers as Record<string, string> | undefined),
      },
    },
  }
  const result = await codeAssistSearch(
    cfg,
    { query, model: model.api.id, project: provider?.options?.project as string | undefined },
    abort,
  )
  return {
    output: result.text || `No search results found for: "${query}"`,
    title: `Web search: ${query}`,
    metadata: {},
  }
}

async function searchViaExa(
  params: { query: string; numResults?: number; livecrawl?: string; type?: string; contextMaxCharacters?: number },
  abort: AbortSignal,
) {
  const searchRequest: McpSearchRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "web_search_exa",
      arguments: {
        query: params.query,
        type: (params.type as "auto" | "fast" | "deep") || "auto",
        numResults: params.numResults || API_CONFIG.DEFAULT_NUM_RESULTS,
        livecrawl: (params.livecrawl as "fallback" | "preferred") || "fallback",
        contextMaxCharacters: params.contextMaxCharacters,
      },
    },
  }

  const { signal, clearTimeout } = abortAfterAny(25000, abort)

  try {
    const headers: Record<string, string> = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    }

    const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(searchRequest),
      signal,
    })

    clearTimeout()

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Search error (${response.status}): ${errorText}`)
    }

    const responseText = await response.text()

    // Parse SSE response
    const lines = responseText.split("\n")
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data: McpSearchResponse = JSON.parse(line.substring(6))
        if (data.result?.content && data.result.content.length > 0) {
          return {
            output: data.result.content[0].text,
            title: `Web search: ${params.query}`,
            metadata: {},
          }
        }
      }
    }

    return {
      output: "No search results found. Please try a different query.",
      title: `Web search: ${params.query}`,
      metadata: {},
    }
  } catch (error) {
    clearTimeout()

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Search request timed out")
    }

    throw error
  }
}
