import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Feedback } from "../../feedback/feedback"
import { lazy } from "../../util/lazy"

export const FeedbackRoutes = lazy(() =>
  new Hono()
    .post(
      "/",
      describeRoute({
        summary: "Submit feedback",
        description: "Submit a feedback report with optional transcript and environment info.",
        operationId: "global.feedback.submit",
        responses: {
          200: {
            description: "Feedback submitted successfully",
            content: {
              "application/json": {
                schema: resolver(Feedback.SubmissionResult),
              },
            },
          },
        },
      }),
      validator("json", Feedback.Submission),
      async (c) => {
        const data = c.req.valid("json")
        const result = await Feedback.submit(data)
        return c.json(result)
      },
    )
    .post(
      "/rate",
      describeRoute({
        summary: "Rate a message",
        description: "Submit a thumbs up/down rating for a specific message.",
        operationId: "global.feedback.rate",
        responses: {
          200: {
            description: "Rating recorded",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("json", Feedback.RatingEntry),
      async (c) => {
        const entry = c.req.valid("json")
        await Feedback.rate(entry)
        return c.json({ ok: true })
      },
    )
    .post(
      "/survey",
      describeRoute({
        summary: "Submit session survey",
        description: "Submit a session-level feedback survey response.",
        operationId: "global.feedback.survey",
        responses: {
          200: {
            description: "Survey response recorded",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("json", Feedback.SurveyEntry),
      async (c) => {
        const entry = c.req.valid("json")
        await Feedback.survey(entry)
        return c.json({ ok: true })
      },
    ),
)
