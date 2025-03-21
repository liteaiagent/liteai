import { describe, expect, test } from "bun:test"
import type { Provider } from "../../src/provider/provider"
import { ProviderTransform } from "../../src/provider/transform"

type Schema = Record<string, unknown>

describe("ProviderTransform.schema - gemini array items", () => {
  test("adds missing items for array properties", () => {
    const geminiModel = {
      providerID: "google",
      api: {
        id: "gemini-3-pro",
      },
    } as unknown as Provider.Model

    const schema = {
      type: "object",
      properties: {
        nodes: { type: "array" },
        edges: { type: "array", items: { type: "string" } },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    expect((result.properties as Schema).nodes as Schema).toHaveProperty("items")
    expect(((result.properties as Schema).edges as Schema).items as Schema).toHaveProperty("type", "string")
  })
})

describe("ProviderTransform.schema - gemini nested array items", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as unknown as Provider.Model

  test("adds type to 2D array with empty inner items", () => {
    const schema = {
      type: "object",
      properties: {
        values: {
          type: "array",
          items: {
            type: "array",
            items: {}, // Empty items object
          },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    // Inner items should have a default type
    const values = (result.properties as Schema).values as Schema
    const inner = (values.items as Schema).items as Schema
    expect(inner.type).toBe("string")
  })

  test("adds items and type to 2D array with missing inner items", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "array" }, // No items at all
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const data = (result.properties as Schema).data as Schema
    const inner = (data.items as Schema).items as Schema
    expect(inner).toBeDefined()
    expect(inner.type).toBe("string")
  })

  test("handles deeply nested arrays (3D)", () => {
    const schema = {
      type: "object",
      properties: {
        matrix: {
          type: "array",
          items: {
            type: "array",
            items: {
              type: "array",
              // No items
            },
          },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const matrix = (result.properties as Schema).matrix as Schema
    const leaf = ((matrix.items as Schema).items as Schema).items as Schema
    expect(leaf).toBeDefined()
    expect(leaf.type).toBe("string")
  })

  test("preserves existing item types in nested arrays", () => {
    const schema = {
      type: "object",
      properties: {
        numbers: {
          type: "array",
          items: {
            type: "array",
            items: { type: "number" }, // Has explicit type
          },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    // Should preserve the explicit type
    const numbers = (result.properties as Schema).numbers as Schema
    const inner = (numbers.items as Schema).items as Schema
    expect(inner.type).toBe("number")
  })

  test("handles mixed nested structures with objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        spreadsheetData: {
          type: "object",
          properties: {
            rows: {
              type: "array",
              items: {
                type: "array",
                items: {}, // Empty items
              },
            },
          },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const spread = (result.properties as Schema).spreadsheetData as Schema
    const rows = (spread.properties as Schema).rows as Schema
    const inner = (rows.items as Schema).items as Schema
    expect(inner.type).toBe("string")
  })
})

describe("ProviderTransform.schema - gemini combiner nodes", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as unknown as Provider.Model

  const walk = (
    node: Schema,
    cb: (node: Schema, path: (string | number)[]) => void,
    path: (string | number)[] = [],
  ) => {
    if (node === null || typeof node !== "object") {
      return
    }
    if (Array.isArray(node)) {
      for (const [i, item] of node.entries()) {
        walk(item as Schema, cb, [...path, i])
      }
      return
    }
    cb(node, path)
    for (const [key, value] of Object.entries(node)) {
      walk(value as Schema, cb, [...path, key])
    }
  }

  test("keeps edits.items.anyOf without adding type", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                },
                required: ["old_string", "new_string"],
              },
              {
                type: "object",
                properties: {
                  old_string: { type: "string" },
                  new_string: { type: "string" },
                  replace_all: { type: "boolean" },
                },
                required: ["old_string", "new_string"],
              },
            ],
          },
        },
      },
      required: ["edits"],
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const edits = (result.properties as Schema).edits as Schema
    const items = edits.items as Schema
    expect(Array.isArray(items.anyOf)).toBe(true)
    expect(items.type).toBeUndefined()
  })

  test("does not add sibling keys to combiner nodes during sanitize", () => {
    const schema = {
      type: "object",
      properties: {
        edits: {
          type: "array",
          items: {
            anyOf: [{ type: "string" }, { type: "number" }],
          },
        },
        value: {
          oneOf: [{ type: "string" }, { type: "boolean" }],
        },
        meta: {
          allOf: [
            {
              type: "object",
              properties: { a: { type: "string" } },
            },
            {
              type: "object",
              properties: { b: { type: "string" } },
            },
          ],
        },
      },
    } as unknown as Schema
    const input = JSON.parse(JSON.stringify(schema)) as Schema
    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    walk(result, (node, path) => {
      const hasCombiner = Array.isArray(node.anyOf) || Array.isArray(node.oneOf) || Array.isArray(node.allOf)
      if (!hasCombiner) {
        return
      }
      const before = path.reduce<Schema>((acc, key) => (acc as Record<string | number, Schema>)[key], input)
      const added = Object.keys(node).filter((key) => !(key in before))
      expect(added).toEqual([])
    })
  })
})

describe("ProviderTransform.schema - gemini non-object properties removal", () => {
  const geminiModel = {
    providerID: "google",
    api: {
      id: "gemini-3-pro",
    },
  } as unknown as Provider.Model

  test("removes properties from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const data = (result.properties as Schema).data as Schema
    expect(data.type).toBe("string")
    expect(data.properties).toBeUndefined()
  })

  test("removes required from non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "array",
          items: { type: "string" },
          required: ["invalid"],
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const data = (result.properties as Schema).data as Schema
    expect(data.type).toBe("array")
    expect(data.required).toBeUndefined()
  })

  test("removes properties and required from nested non-object types", () => {
    const schema = {
      type: "object",
      properties: {
        outer: {
          type: "object",
          properties: {
            inner: {
              type: "number",
              properties: { bad: { type: "string" } },
              required: ["bad"],
            },
          },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const outer = (result.properties as Schema).outer as Schema
    const inner = (outer.properties as Schema).inner as Schema
    expect(inner.type).toBe("number")
    expect(inner.properties).toBeUndefined()
    expect(inner.required).toBeUndefined()
  })

  test("keeps properties and required on object types", () => {
    const schema = {
      type: "object",
      properties: {
        data: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(geminiModel, schema) as Schema

    const data = (result.properties as Schema).data as Schema
    expect(data.type).toBe("object")
    expect(data.properties).toBeDefined()
    expect(data.required).toEqual(["name"])
  })

  test("does not affect non-gemini providers", () => {
    const openaiModel = {
      providerID: "openai",
      api: {
        id: "gpt-4",
      },
    } as unknown as Provider.Model

    const schema = {
      type: "object",
      properties: {
        data: {
          type: "string",
          properties: { invalid: { type: "string" } },
        },
      },
    } as unknown as Schema

    const result = ProviderTransform.schema(openaiModel, schema) as Schema

    const data = (result.properties as Schema).data as Schema
    expect(data.properties).toBeDefined()
  })
})
