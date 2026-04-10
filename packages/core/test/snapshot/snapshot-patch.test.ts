import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Snapshot } from "../../src/snapshot"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

// Git always outputs /-separated paths internally. Snapshot.patch() joins them
// with path.join (which produces \\ on Windows) then normalizes back to /.
// This helper does the same for expected values so assertions match cross-platform.
const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")

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

test("tracks deleted files correctly", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await $`rm ${tmp.path}/a.txt`.quiet()

      expect((await Snapshot.patch(before)).files).toContain(fwd(tmp.path, "a.txt"))
    },
  })
}, 30_000)

test("revert should remove new files", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await Filesystem.write(`${tmp.path}/new.txt`, "NEW")

      await Snapshot.revert([await Snapshot.patch(before)])

      expect(
        await fs
          .access(`${tmp.path}/new.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 30_000)

test("revert in subdirectory", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await $`mkdir -p ${tmp.path}/sub`.quiet()
      await Filesystem.write(`${tmp.path}/sub/file.txt`, "SUB")

      await Snapshot.revert([await Snapshot.patch(before)])

      expect(
        await fs
          .access(`${tmp.path}/sub/file.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      // Note: revert currently only removes files, not directories
      // The empty subdirectory will remain
    },
  })
}, 30_000)

test("multiple file operations", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/c.txt`, "C")
      await $`mkdir -p ${tmp.path}/dir`.quiet()
      await Filesystem.write(`${tmp.path}/dir/d.txt`, "D")
      await Filesystem.write(`${tmp.path}/b.txt`, "MODIFIED")

      await Snapshot.revert([await Snapshot.patch(before)])

      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)
      expect(
        await fs
          .access(`${tmp.path}/c.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      // Note: revert currently only removes files, not directories
      // The empty directory will remain
      expect(await fs.readFile(`${tmp.path}/b.txt`, "utf-8")).toBe(tmp.extra.bContent)
    },
  })
}, 30_000)

test("empty directory handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await $`mkdir ${tmp.path}/empty`.quiet()

      expect((await Snapshot.patch(before)).files.length).toBe(0)
    },
  })
}, 30_000)

test("binary file handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await Filesystem.write(`${tmp.path}/image.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

      const patch = await Snapshot.patch(before)
      expect(patch.files).toContain(fwd(tmp.path, "image.png"))

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(`${tmp.path}/image.png`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 30_000)

test("symlink handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await fs.symlink(`${tmp.path}/a.txt`, `${tmp.path}/link.txt`, "file")

      expect((await Snapshot.patch(before)).files).toContain(fwd(tmp.path, "link.txt"))
    },
  })
}, 30_000)

test("large file handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await Filesystem.write(`${tmp.path}/large.txt`, "x".repeat(1024 * 1024))

      expect((await Snapshot.patch(before)).files).toContain(fwd(tmp.path, "large.txt"))
    },
  })
}, 30_000)

test("nested directory revert", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await $`mkdir -p ${tmp.path}/level1/level2/level3`.quiet()
      await Filesystem.write(`${tmp.path}/level1/level2/level3/deep.txt`, "DEEP")

      await Snapshot.revert([await Snapshot.patch(before)])

      expect(
        await fs
          .access(`${tmp.path}/level1/level2/level3/deep.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 30_000)

test("special characters in filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      await Filesystem.write(`${tmp.path}/file with spaces.txt`, "SPACES")
      await Filesystem.write(`${tmp.path}/file-with-dashes.txt`, "DASHES")
      await Filesystem.write(`${tmp.path}/file_with_underscores.txt`, "UNDERSCORES")

      const files = (await Snapshot.patch(before)).files
      expect(files).toContain(fwd(tmp.path, "file with spaces.txt"))
      expect(files).toContain(fwd(tmp.path, "file-with-dashes.txt"))
      expect(files).toContain(fwd(tmp.path, "file_with_underscores.txt"))
    },
  })
}, 30_000)

test("revert with empty patches", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Should not crash with empty patches
      expect(Snapshot.revert([])).resolves.toBeUndefined()

      // Should not crash with patches that have empty file lists
      expect(Snapshot.revert([{ hash: "dummy", files: [] }])).resolves.toBeUndefined()
    },
  })
}, 30_000)

test("patch with invalid hash", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Create a change
      await Filesystem.write(`${tmp.path}/test.txt`, "TEST")

      // Try to patch with invalid hash - should handle gracefully
      const patch = await Snapshot.patch("invalid-hash-12345")
      expect(patch.files).toEqual([])
      expect(patch.hash).toBe("invalid-hash-12345")
    },
  })
}, 90_000)

test("revert non-existent file", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      // Try to revert a file that doesn't exist in the snapshot
      // This should not crash
      expect(
        Snapshot.revert([
          {
            hash: before,
            files: [`${tmp.path}/nonexistent.txt`],
          },
        ]),
      ).resolves.toBeUndefined()
    },
  })
}, 30_000)

test("track with no changes returns same hash", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const hash1 = await Snapshot.track()
      if (!hash1) throw new Error("expected hash")

      // Track again with no changes
      const hash2 = await Snapshot.track()
      expect(hash2).toBe(hash1)

      // Track again
      const hash3 = await Snapshot.track()
      expect(hash3).toBe(hash1)
    },
  })
}, 30_000)

test("diff function with various changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      // Make various changes
      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/new.txt`, "new content")
      await Filesystem.write(`${tmp.path}/b.txt`, "modified content")

      const diff = await Snapshot.diff(before)
      expect(diff).toContain("a.txt")
      expect(diff).toContain("b.txt")
      expect(diff).toContain("new.txt")
    },
  })
}, 30_000)

test("restore function", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      if (!before) throw new Error("expected hash")

      // Make changes
      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/new.txt`, "new content")
      await Filesystem.write(`${tmp.path}/b.txt`, "modified")

      // Restore to original state
      await Snapshot.restore(before)

      expect(
        await fs
          .access(`${tmp.path}/a.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)
      expect(
        await fs
          .access(`${tmp.path}/new.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(true) // New files should remain
      expect(await fs.readFile(`${tmp.path}/b.txt`, "utf-8")).toBe(tmp.extra.bContent)
    },
  })
}, 30_000)

test("revert should not delete files that existed but were deleted in snapshot", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const snapshot1 = await Snapshot.track()
      if (!snapshot1) throw new Error("expected hash")

      await $`rm ${tmp.path}/a.txt`.quiet()

      const snapshot2 = await Snapshot.track()
      if (!snapshot2) throw new Error("expected hash")

      await Filesystem.write(`${tmp.path}/a.txt`, "recreated content")

      const patch = await Snapshot.patch(snapshot2)
      expect(patch.files).toContain(fwd(tmp.path, "a.txt"))

      await Snapshot.revert([patch])

      expect(
        await fs
          .access(`${tmp.path}/a.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
}, 30_000)

test("revert preserves file that existed in snapshot when deleted then recreated", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/existing.txt`, "original content")

      const snapshot = await Snapshot.track()
      if (!snapshot) throw new Error("expected hash")

      await $`rm ${tmp.path}/existing.txt`.quiet()
      await Filesystem.write(`${tmp.path}/existing.txt`, "recreated")
      await Filesystem.write(`${tmp.path}/newfile.txt`, "new")

      const patch = await Snapshot.patch(snapshot)
      expect(patch.files).toContain(fwd(tmp.path, "existing.txt"))
      expect(patch.files).toContain(fwd(tmp.path, "newfile.txt"))

      await Snapshot.revert([patch])

      expect(
        await fs
          .access(`${tmp.path}/newfile.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      expect(
        await fs
          .access(`${tmp.path}/existing.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(await fs.readFile(`${tmp.path}/existing.txt`, "utf-8")).toBe("original content")
    },
  })
}, 30_000)
