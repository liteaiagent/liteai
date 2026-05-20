/**
 * Cross-platform setup script for linking documentation content.
 *
 * Creates a junction (Windows) or symlink (Linux/Mac) from
 * packages/docs/src/content/docs → ../../../../docs
 *
 * This runs automatically via `postinstall` in package.json.
 * It is idempotent — safe to run multiple times.
 */

import { execSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const scriptDir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const projectRoot = resolve(scriptDir, "..");
const contentDir = resolve(projectRoot, "src", "content", "docs");
const docsDir = resolve(projectRoot, "..", "..", "docs");

// Verify the canonical docs/ directory exists
if (!existsSync(docsDir)) {
	console.error(`✗ docs/ directory not found at ${docsDir}`);
	process.exit(1);
}

// Check if link already exists and is valid
if (existsSync(contentDir)) {
	try {
		const stat = lstatSync(contentDir);
		if (stat.isSymbolicLink() || stat.isDirectory()) {
			// Verify it actually contains content (not an empty dir)
			const entries = readdirSync(contentDir);
			if (entries.length > 0) {
				console.log("✓ docs content link already exists, skipping.");
				process.exit(0);
			}
		}
	} catch {
		// If we can't stat it, remove and recreate
	}
}

// Ensure the parent directory exists (src/content/ has no tracked files
// since the symlinked docs/ subfolder is gitignored, so on a fresh clone
// this directory won't exist)
mkdirSync(dirname(contentDir), { recursive: true });

// Create the appropriate link type
if (process.platform === "win32") {
	// Windows: use directory junction (no admin required)
	execSync(`mklink /J "${contentDir}" "${docsDir}"`, { stdio: "inherit" });
} else {
	// Linux/Mac: use relative symlink for portability
	const relativeTarget = "../../../../docs";
	execSync(`ln -s "${relativeTarget}" "${contentDir}"`, { stdio: "inherit" });
}

console.log("✓ Created docs content link");
