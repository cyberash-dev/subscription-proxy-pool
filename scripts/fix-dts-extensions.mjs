/*
 * Post-build: tsc's `rewriteRelativeImportExtensions` rewrites `.ts` -> `.js` in
 * emitted JS but leaves declaration specifiers as `.ts`. Rewrite relative
 * specifiers in dist/**\/*.d.ts to `.js` so consumers resolve them without
 * `allowImportingTsExtensions`.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function rewrite(dir) {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) {
			rewrite(path);
		} else if (path.endsWith(".d.ts")) {
			const source = readFileSync(path, "utf8");
			const rewritten = source.replace(
				/(from\s+")(\.[^"]+)\.ts(")/g,
				"$1$2.js$3",
			);
			if (rewritten !== source) {
				writeFileSync(path, rewritten);
			}
		}
	}
}

rewrite("dist");
