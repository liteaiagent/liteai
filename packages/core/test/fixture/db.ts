import { rm } from "node:fs/promises"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"

export async function resetDatabase() {
  await Instance.disposeAll().catch(() => undefined)
  Database.close()
  await rm(Database.Path, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-wal`, { force: true }).catch(() => undefined)
  await rm(`${Database.Path}-shm`, { force: true }).catch(() => undefined)

  const { Project } = await import("../../src/project/project")
  const path = await import("node:path")
  await Project.fromDirectory(path.join(import.meta.dir, "../.."))
}
