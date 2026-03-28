import { expect, test } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

async function bootstrap() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      const unique = Math.random().toString(36).slice(2)
      const aContent = `A${unique}`
      const bContent = `B${unique}`
      await Filesystem.write(`${dir}/a.txt`, aContent)
      await Filesystem.write(`${dir}/b.txt`, bContent)
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
      return {
        aContent,
        bContent,
      }
    },
  })
}

test("diffFull sets status based on git change type", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/grow.txt`, "one\n")
      await Filesystem.write(`${tmp.path}/trim.txt`, "line1\nline2\n")
      await Filesystem.write(`${tmp.path}/delete.txt`, "gone")

      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/grow.txt`, "one\ntwo\n")
      await Filesystem.write(`${tmp.path}/trim.txt`, "line1\n")
      await $`rm ${tmp.path}/delete.txt`.quiet()
      await Filesystem.write(`${tmp.path}/added.txt`, "new")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(4)

      const added = diffs.find((d) => d.file === "added.txt")
      expect(added).toBeDefined()
      expect(added?.status).toBe("added")

      const deleted = diffs.find((d) => d.file === "delete.txt")
      expect(deleted).toBeDefined()
      expect(deleted?.status).toBe("deleted")

      const grow = diffs.find((d) => d.file === "grow.txt")
      expect(grow).toBeDefined()
      expect(grow?.status).toBe("modified")
      expect(grow?.additions).toBeGreaterThan(0)
      expect(grow?.deletions).toBe(0)

      const trim = diffs.find((d) => d.file === "trim.txt")
      expect(trim).toBeDefined()
      expect(trim?.status).toBe("modified")
      expect(trim?.additions).toBe(0)
      expect(trim?.deletions).toBeGreaterThan(0)
    },
  })
}, 30_000)

test("diffFull with new file additions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/new.txt`, "new content")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const newFileDiff = diffs[0]
      expect(newFileDiff.file).toBe("new.txt")
      expect(newFileDiff.before).toBe("")
      expect(newFileDiff.after).toBe("new content")
      expect(newFileDiff.additions).toBe(1)
      expect(newFileDiff.deletions).toBe(0)
    },
  })
}, 30_000)

test("diffFull with file modifications", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/b.txt`, "modified content")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const modifiedFileDiff = diffs[0]
      expect(modifiedFileDiff.file).toBe("b.txt")
      expect(modifiedFileDiff.before).toBe(tmp.extra.bContent)
      expect(modifiedFileDiff.after).toBe("modified content")
      expect(modifiedFileDiff.additions).toBeGreaterThan(0)
      expect(modifiedFileDiff.deletions).toBeGreaterThan(0)
    },
  })
}, 30_000)

test("diffFull with file deletions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await $`rm ${tmp.path}/a.txt`.quiet()

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const removedFileDiff = diffs[0]
      expect(removedFileDiff.file).toBe("a.txt")
      expect(removedFileDiff.before).toBe(tmp.extra.aContent)
      expect(removedFileDiff.after).toBe("")
      expect(removedFileDiff.additions).toBe(0)
      expect(removedFileDiff.deletions).toBe(1)
    },
  })
}, 30_000)

test("diffFull with multiple line additions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/multi.txt`, "line1\nline2\nline3")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const multiDiff = diffs[0]
      expect(multiDiff.file).toBe("multi.txt")
      expect(multiDiff.before).toBe("")
      expect(multiDiff.after).toBe("line1\nline2\nline3")
      expect(multiDiff.additions).toBe(3)
      expect(multiDiff.deletions).toBe(0)
    },
  })
}, 30_000)

test("diffFull with addition and deletion", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/added.txt`, "added content")
      await $`rm ${tmp.path}/a.txt`.quiet()

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(2)

      const addedFileDiff = diffs.find((d) => d.file === "added.txt")
      expect(addedFileDiff).toBeDefined()
      expect(addedFileDiff?.before).toBe("")
      expect(addedFileDiff?.after).toBe("added content")
      expect(addedFileDiff?.additions).toBe(1)
      expect(addedFileDiff?.deletions).toBe(0)

      const removedFileDiff = diffs.find((d) => d.file === "a.txt")
      expect(removedFileDiff).toBeDefined()
      expect(removedFileDiff?.before).toBe(tmp.extra.aContent)
      expect(removedFileDiff?.after).toBe("")
      expect(removedFileDiff?.additions).toBe(0)
      expect(removedFileDiff?.deletions).toBe(1)
    },
  })
}, 30_000)

test("diffFull with multiple additions and deletions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/multi1.txt`, "line1\nline2\nline3")
      await Filesystem.write(`${tmp.path}/multi2.txt`, "single line")
      await $`rm ${tmp.path}/a.txt`.quiet()
      await $`rm ${tmp.path}/b.txt`.quiet()

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(4)

      const multi1Diff = diffs.find((d) => d.file === "multi1.txt")
      expect(multi1Diff).toBeDefined()
      expect(multi1Diff?.additions).toBe(3)
      expect(multi1Diff?.deletions).toBe(0)

      const multi2Diff = diffs.find((d) => d.file === "multi2.txt")
      expect(multi2Diff).toBeDefined()
      expect(multi2Diff?.additions).toBe(1)
      expect(multi2Diff?.deletions).toBe(0)

      const removedADiff = diffs.find((d) => d.file === "a.txt")
      expect(removedADiff).toBeDefined()
      expect(removedADiff?.additions).toBe(0)
      expect(removedADiff?.deletions).toBe(1)

      const removedBDiff = diffs.find((d) => d.file === "b.txt")
      expect(removedBDiff).toBeDefined()
      expect(removedBDiff?.additions).toBe(0)
      expect(removedBDiff?.deletions).toBe(1)
    },
  })
}, 30_000)

test("diffFull with no changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(0)
    },
  })
}, 30_000)

test("diffFull with binary file changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/binary.bin`, new Uint8Array([0x00, 0x01, 0x02, 0x03]))

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const binaryDiff = diffs[0]
      expect(binaryDiff.file).toBe("binary.bin")
      expect(binaryDiff.before).toBe("")
    },
  })
}, 30_000)

test("diffFull with whitespace changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/whitespace.txt`, "line1\nline2")
      const before = await Snapshot.track()
      if (!before) throw new Error("expected before")

      await Filesystem.write(`${tmp.path}/whitespace.txt`, "line1\n\nline2\n")

      const after = await Snapshot.track()
      if (!after) throw new Error("expected after")

      const diffs = await Snapshot.diffFull(before, after)
      expect(diffs.length).toBe(1)

      const whitespaceDiff = diffs[0]
      expect(whitespaceDiff.file).toBe("whitespace.txt")
      expect(whitespaceDiff.additions).toBeGreaterThan(0)
    },
  })
}, 30_000)
