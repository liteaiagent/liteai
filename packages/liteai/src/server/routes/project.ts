import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { InstanceBootstrap } from "../../project/bootstrap"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { ProjectID } from "../../project/schema"
import { NotFoundError } from "../../storage/db"
import { lazy } from "../../util/lazy"
import { errors } from "../error"
import { safeDecodeDirectory } from "../middleware"

/**
 * Tier 2 project routes — these operate on projectID and do NOT require
 * instance context (no LSP, plugins, MCP, file watchers, etc.).
 */
export const ProjectRoutes = lazy(() =>
  new Hono()
    .get(
      "/:projectID",
      describeRoute({
        summary: "Get project",
        description: "Retrieve a project by its ID.",
        operationId: "project.get",
        responses: {
          200: {
            description: "Project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) => {
        const project = Project.get(c.req.valid("param").projectID)
        if (!project) {
          throw new NotFoundError({ message: "Project not found" })
        }
        return c.json(project)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    )
    .patch(
      "/:projectID/archive",
      describeRoute({
        summary: "Archive project",
        description: "Archive a project to hide it from the project list. Data and sessions are preserved.",
        operationId: "project.archive",
        responses: {
          200: {
            description: "Archived project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) => {
        const project = await Project.setArchived({ projectID: c.req.valid("param").projectID, time: Date.now() })
        return c.json(project)
      },
    )
    .patch(
      "/:projectID/unarchive",
      describeRoute({
        summary: "Unarchive project",
        description: "Restore an archived project so it appears in the project list again.",
        operationId: "project.unarchive",
        responses: {
          200: {
            description: "Unarchived project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ projectID: ProjectID.zod })),
      async (c) => {
        const project = await Project.setArchived({ projectID: c.req.valid("param").projectID, time: undefined })
        return c.json(project)
      },
    )
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description:
          "Create a git repository for a project directory and return the refreshed project info. Requires a directory parameter.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string(),
        }),
      ),
      async (c) => {
        const raw = c.req.valid("query").directory
        const directory = safeDecodeDirectory(raw)

        // Resolve project from directory
        const resolved = await Project.resolve(directory)
        const existing = Project.get(resolved.id)
        if (!existing) {
          throw new NotFoundError({
            message: `Project not registered for directory: ${directory}. Register via POST /project first.`,
          })
        }

        const next = await Project.initGit({ directory, project: existing })
        if (existing.vcs !== "git") {
          Instance.reload({ directory, init: InstanceBootstrap })
        }
        return c.json(next)
      },
    ),
)
