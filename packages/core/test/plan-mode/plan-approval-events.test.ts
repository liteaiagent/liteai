import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

describe("PlanApproval Bus events", () => {
  const subscriptions: Array<() => void> = []
  afterEach(() => {
    for (const unsub of subscriptions) {
      try {
        unsub()
      } catch {
        // Already unsubscribed
      }
    }
    subscriptions.length = 0
  })

  test("PlanApprovalRequested event carries planText and planFilePath", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_test_approval")
        let received = false

        const unsub = Bus.subscribe(Session.Event.PlanApprovalRequested, (event) => {
          if (event.properties.sessionID === sessionID) {
            received = true
            expect(event.properties.planText).toBe("My plan content")
            expect(event.properties.planFilePath).toBe("/path/to/plan.md")
          }
        })
        subscriptions.push(unsub)

        Bus.publish(Session.Event.PlanApprovalRequested, {
          sessionID,
          planText: "My plan content",
          planFilePath: "/path/to/plan.md",
        })

        expect(received).toBe(true)
      },
    })
  })

  test("PlanApprovalResolved event carries approved=true", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_test_resolve")
        let received = false

        const unsub = Bus.subscribe(Session.Event.PlanApprovalResolved, (event) => {
          if (event.properties.sessionID === sessionID) {
            received = true
            expect(event.properties.approved).toBe(true)
            expect(event.properties.feedback).toBeUndefined()
          }
        })
        subscriptions.push(unsub)

        Bus.publish(Session.Event.PlanApprovalResolved, {
          sessionID,
          approved: true,
        })

        expect(received).toBe(true)
      },
    })
  })

  test("PlanApprovalResolved event carries approved=false with feedback", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = SessionID.make("ses_test_reject")
        let received = false

        const unsub = Bus.subscribe(Session.Event.PlanApprovalResolved, (event) => {
          if (event.properties.sessionID === sessionID) {
            received = true
            expect(event.properties.approved).toBe(false)
            expect(event.properties.feedback).toBe("Add more detail")
          }
        })
        subscriptions.push(unsub)

        Bus.publish(Session.Event.PlanApprovalResolved, {
          sessionID,
          approved: false,
          feedback: "Add more detail",
        })

        expect(received).toBe(true)
      },
    })
  })

  test("PlanApprovalResolved only triggers for matching sessionID", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const targetSession = SessionID.make("ses_target")
        const otherSession = SessionID.make("ses_other")
        let targetReceived = false
        let otherReceived = false

        const unsub = Bus.subscribe(Session.Event.PlanApprovalResolved, (event) => {
          if (event.properties.sessionID === targetSession) {
            targetReceived = true
          }
          if (event.properties.sessionID === otherSession) {
            otherReceived = true
          }
        })
        subscriptions.push(unsub)

        Bus.publish(Session.Event.PlanApprovalResolved, {
          sessionID: targetSession,
          approved: true,
        })

        expect(targetReceived).toBe(true)
        expect(otherReceived).toBe(false)
      },
    })
  })
})
