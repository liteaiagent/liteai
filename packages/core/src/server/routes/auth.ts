import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Auth } from "../../auth"
import { Instance } from "../../project/instance"
import { ProviderID } from "../../provider/schema"
import { globalState } from "../../provider/state"
import { lazy } from "../../util/lazy"
import { errors } from "../error"

export const AuthRoutes = lazy(() =>
  new Hono()
    .put(
      "/:providerID",
      describeRoute({
        summary: "Set auth credentials",
        description: "Set authentication credentials",
        operationId: "auth.set",
        responses: {
          200: {
            description: "Successfully set authentication credentials",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      validator("json", Auth.Info),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        const info = c.req.valid("json")
        await Auth.set(providerID, info)
        globalState.reset()
        await Instance.disposeAll()
        return c.json(true)
      },
    )
    .delete(
      "/:providerID",
      describeRoute({
        summary: "Remove auth credentials",
        description: "Remove authentication credentials",
        operationId: "auth.remove",
        responses: {
          200: {
            description: "Successfully removed authentication credentials",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod,
        }),
      ),
      async (c) => {
        const providerID = c.req.valid("param").providerID
        await Auth.remove(providerID)
        globalState.reset()
        await Instance.disposeAll()
        return c.json(true)
      },
    ),
)
