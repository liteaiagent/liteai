#!/usr/bin/env bun

import { Auth } from "../src/auth"
import { CA_CLIENT_ID, CA_CLIENT_SECRET } from "../src/auth/providers/code-assist"
import { fetchAvailableModels, loadCodeAssist } from "../src/provider/sdk/code-assist/client"
import { Database } from "../src/storage/db"
import { Log } from "../src/util/log"

await Log.init({
  print: true,
  dev: true,
  level: "DEBUG",
})

// Initialize local database which contains the auth tokens
Database.Client()

const auth = await Auth.get("google-code-assist")
if (!auth || auth.type !== "oauth") {
  console.error("No google-code-assist auth found in db. Please authorize the app first through the UI.")
  process.exit(1)
}

const { OAuth2Client } = await import("google-auth-library")
const client = new OAuth2Client({
  clientId: CA_CLIENT_ID,
  clientSecret: CA_CLIENT_SECRET,
})

client.setCredentials({
  access_token: auth.access,
  refresh_token: auth.refresh,
  expiry_date: auth.expires,
})

client.on("tokens", async (tokens) => {
  console.log("Received new tokens, updating DB...")
  const current = await Auth.get("google-code-assist")
  if (current?.type === "oauth") {
    await Auth.set("google-code-assist", {
      ...current,
      refresh: tokens.refresh_token || current.refresh,
      access: tokens.access_token || current.access,
      expires: tokens.expiry_date ?? Date.now() + 3600 * 1000,
    })
  }
})

console.log("\nTesting loadCodeAssist via gaxios...")
try {
  const req = {
    metadata: {
      ideType: "ANTIGRAVITY",
      ideVersion: "1.0.0",
      pluginVersion: "1.0.0",
    },
  }
  const caRes = await loadCodeAssist({ client }, req)
  console.log("\n✅ Success! loadCodeAssist Response:")
  console.log(JSON.stringify(caRes, null, 2))
} catch (error: unknown) {
  const e = error as { response?: { status: number; statusText: string; data: unknown } }
  console.error("\n❌ Request Failed for loadCodeAssist!")
  if (e?.response) {
    console.error("Status:", e.response.status, e.response.statusText)
    console.error("Body:", JSON.stringify(e.response.data, null, 2))
  } else {
    console.error(error)
  }
}

const projectId = "zen-sunlight-z87wj"
client.projectId = projectId

const cfg = {
  client,
  // httpOptions: {
  //   headers: {
  //     "x-goog-user-project": projectId
  //   }
  // }
}

console.log(`Testing fetchAvailableModels via gaxios with project ${projectId}...`)
try {
  const res = await fetchAvailableModels(cfg)
  console.log("\n✅ Success! Available Models:")
  console.log(JSON.stringify(res, null, 2))
} catch (error: unknown) {
  const e = error as { response?: { status: number; statusText: string; data: unknown } }
  console.error("\n❌ Request Failed for fetchAvailableModels!")
  if (e?.response) {
    console.error("Status:", e.response.status, e.response.statusText)
    console.error("Body:", JSON.stringify(e.response.data, null, 2))
  } else {
    console.error(error)
  }
}

process.exit(0)
