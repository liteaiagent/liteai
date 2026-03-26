import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { download } from "../../plugin/download"
import { known, remove as removeMarketplace } from "../../plugin/marketplace"
import { load, resolve as resolveMarketplace } from "../../plugin/marketplace-source"
import { disable, enable, install, list as listPlugins, uninstall } from "../../plugin/registry"
import { lazy } from "../../util/lazy"

const MarketplaceInfo = z.object({
  name: z.string(),
  source: z.union([
    z.object({ source: z.literal("github"), repo: z.string() }),
    z.object({ source: z.literal("url"), url: z.string() }),
    z.string(),
  ]),
  added: z.string().optional(),
})

const PluginInfo = z.object({
  id: z.string(),
  name: z.string(),
  marketplace: z.string(),
  version: z.string().optional(),
  enabled: z.boolean(),
  scope: z.enum(["user", "project", "local"]),
})

export const PluginRoutes = lazy(() =>
  new Hono()
    // List installed plugins
    .get(
      "/",
      describeRoute({
        summary: "List installed plugins",
        operationId: "plugin.list",
        responses: {
          200: {
            description: "List of installed plugins",
            content: { "application/json": { schema: resolver(PluginInfo.array()) } },
          },
        },
      }),
      async (c) => {
        const plugins = await listPlugins()
        return c.json(plugins)
      },
    )
    // Enable a plugin
    .post(
      "/:id/enable",
      describeRoute({
        summary: "Enable a plugin",
        operationId: "plugin.enable",
        responses: {
          200: { description: "Plugin enabled", content: { "application/json": { schema: resolver(z.boolean()) } } },
        },
      }),
      async (c) => {
        const id = decodeURIComponent(c.req.param("id"))
        await enable(id)
        return c.json(true)
      },
    )
    // Disable a plugin
    .post(
      "/:id/disable",
      describeRoute({
        summary: "Disable a plugin",
        operationId: "plugin.disable",
        responses: {
          200: { description: "Plugin disabled", content: { "application/json": { schema: resolver(z.boolean()) } } },
        },
      }),
      async (c) => {
        const id = decodeURIComponent(c.req.param("id"))
        await disable(id)
        return c.json(true)
      },
    )
    // Uninstall a plugin
    .delete(
      "/:id",
      describeRoute({
        summary: "Uninstall a plugin",
        operationId: "plugin.uninstall",
        responses: {
          200: {
            description: "Plugin uninstalled",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        const id = decodeURIComponent(c.req.param("id"))
        await uninstall(id)
        return c.json(true)
      },
    )
    // List known marketplaces
    .get(
      "/marketplace",
      describeRoute({
        summary: "List known marketplaces",
        operationId: "plugin.marketplace.list",
        responses: {
          200: {
            description: "Known marketplaces",
            content: { "application/json": { schema: resolver(MarketplaceInfo.array()) } },
          },
        },
      }),
      async (c) => {
        const all = await known()
        const result = Object.entries(all).map(([n, ref]) => ({
          name: ref.displayName ?? n,
          id: n,
          source: ref.source,
          added: ref.added,
        }))
        return c.json(result)
      },
    )
    // Add a marketplace and fetch its plugins
    .post(
      "/marketplace",
      describeRoute({
        summary: "Add a marketplace",
        operationId: "plugin.marketplace.add",
        responses: {
          200: {
            description: "Marketplace added",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    name: z.string(),
                    available: z.number(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("json", z.object({ source: z.string() })),
      async (c) => {
        const { source } = c.req.valid("json")
        const result = await resolveMarketplace(source)
        if (!result) return c.json({ error: "Failed to resolve marketplace" }, 400)
        return c.json({ name: result.name, available: result.manifest.plugins.length })
      },
    )
    // Remove a marketplace
    .delete(
      "/marketplace/:name",
      describeRoute({
        summary: "Remove a marketplace",
        operationId: "plugin.marketplace.remove",
        responses: {
          200: {
            description: "Marketplace removed",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        const n = decodeURIComponent(c.req.param("name"))
        await removeMarketplace(n)
        return c.json(true)
      },
    )
    // List plugins available in a marketplace
    .get(
      "/marketplace/:name/plugins",
      describeRoute({
        summary: "List marketplace plugins",
        operationId: "plugin.marketplace.plugins",
        responses: {
          200: {
            description: "Plugins in marketplace",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      name: z.string(),
                      description: z.string().optional(),
                      version: z.string().optional(),
                      author: z.string().optional(),
                      tags: z.string().array().optional(),
                    })
                    .array(),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const n = decodeURIComponent(c.req.param("name"))
        const all = await known()
        const ref = all[n]
        if (!ref) return c.json({ error: "Marketplace not found" }, 404)
        const manifest = await load(n, ref)
        if (!manifest) return c.json([])
        return c.json(
          manifest.plugins.map((p) => ({
            name: p.name,
            description: p.description,
            version: p.version,
            author: p.author?.name,
            tags: p.tags,
          })),
        )
      },
    )
    // Install a plugin from a marketplace
    .post(
      "/marketplace/:name/install/:plugin",
      describeRoute({
        summary: "Install a plugin from a marketplace",
        operationId: "plugin.marketplace.install",
        responses: {
          200: {
            description: "Plugin installed",
            content: { "application/json": { schema: resolver(z.boolean()) } },
          },
        },
      }),
      async (c) => {
        const marketplace = decodeURIComponent(c.req.param("name"))
        const pluginName = decodeURIComponent(c.req.param("plugin"))

        const all = await known()
        const ref = all[marketplace]
        if (!ref) return c.json({ error: "Marketplace not found" }, 404)

        const manifest = await load(marketplace, ref)
        if (!manifest) return c.json({ error: "Could not load marketplace manifest" }, 400)

        const entry = manifest.plugins.find((p) => p.name === pluginName)
        if (!entry) return c.json({ error: `Plugin '${pluginName}' not found in marketplace` }, 404)

        const dest = await download(marketplace, entry)
        if (!dest) return c.json({ error: "Failed to download plugin" }, 500)

        await install({ name: pluginName, root: dest, marketplace, version: entry.version })
        return c.json(true)
      },
    ),
)
