/* Aggregate test runner: runs each suite from suites.ts as a child, scans its
 * stdout for the last balanced {suite,results} JSON object, and flattens all
 * suites into spec/runs/m1/spp-acceptance.json with a pass/fail verdict. */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SUITE_FILES } from "./suites.ts";

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HARNESS_DIR, "..");
const RESULTS_PATH = join(
	PACKAGE_ROOT,
	"spec",
	"runs",
	"m1",
	"spp-acceptance.json",
);

interface SuiteSpec {
	readonly name: string;
	readonly file: string;
}

const SUITES: ReadonlyArray<SuiteSpec> = SUITE_FILES.map((rel) => ({
	name: rel.replace(/\.test\.ts$/, ""),
	file: join(PACKAGE_ROOT, ...rel.split("/")),
}));

interface SuiteOutcome {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
}

function runSuite(file: string): Promise<SuiteOutcome> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, ["--import", "tsx", file], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const outChunks: string[] = [];
		const errChunks: string[] = [];
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (c: string) => outChunks.push(c));
		child.stderr.on("data", (c: string) => errChunks.push(c));
		child.once("exit", (code) => {
			resolve({
				stdout: outChunks.join(""),
				stderr: errChunks.join(""),
				exitCode: code,
			});
		});
	});
}

interface RawResult {
	readonly name: string;
	readonly ok: boolean;
	readonly error?: string;
}

interface AggregatedSuite {
	readonly suite?: string;
	readonly results: RawResult[];
}

function extractSuiteResults(stdout: string): AggregatedSuite | null {
	for (let end = stdout.length; end > 0; end--) {
		if (stdout[end - 1] !== "}") {
			continue;
		}
		let depth = 0;
		let inString = false;
		let escaped = false;
		scan: for (let start = end - 1; start >= 0; start--) {
			const ch = stdout[start];
			if (ch === undefined) {
				continue;
			}
			if (escaped) {
				escaped = false;
				continue;
			}
			if (inString) {
				if (ch === "\\") {
					escaped = true;
					continue;
				}
				if (ch === '"') {
					inString = false;
				}
				continue;
			}
			switch (ch) {
				case '"':
					inString = true;
					break;
				case "}":
					depth++;
					break;
				case "{": {
					depth--;
					if (depth === 0) {
						const candidate = stdout.slice(start, end);
						try {
							const parsed: unknown = JSON.parse(candidate);
							if (
								parsed !== null &&
								typeof parsed === "object" &&
								Array.isArray((parsed as AggregatedSuite).results)
							) {
								return parsed as AggregatedSuite;
							}
						} catch {
							/* keep scanning */
						}
						break scan;
					}
					break;
				}
				default:
					break;
			}
		}
	}
	return null;
}

interface FlatTestRecord {
	readonly name: string;
	readonly status: "pass" | "fail";
	readonly suite: string;
	readonly diagnostics: { readonly error: string } | null;
}

function nowIso(): string {
	return new Date().toISOString();
}

async function main(): Promise<void> {
	const flat: FlatTestRecord[] = [];

	for (const suite of SUITES) {
		const out = await runSuite(suite.file);
		const parsed = extractSuiteResults(out.stdout);
		if (parsed === null) {
			flat.push({
				name: `${suite.name}::SUITE_LOAD`,
				status: "fail",
				suite: suite.name,
				diagnostics: {
					error: `no_parsable_results exit=${out.exitCode} stderrTail=${out.stderr.slice(-512)}`,
				},
			});
			continue;
		}
		for (const r of parsed.results) {
			flat.push({
				name: r.name,
				status: r.ok ? "pass" : "fail",
				suite: suite.name,
				diagnostics: r.ok ? null : { error: r.error ?? "unknown" },
			});
		}
		process.stdout.write(
			`${JSON.stringify({ suite: suite.name, exit: out.exitCode, count: parsed.results.length })}\n`,
		);
	}

	const verdict: "pass" | "fail" = flat.every((t) => t.status === "pass")
		? "pass"
		: "fail";

	const report = {
		ranAt: nowIso(),
		platform: platform(),
		tests: flat,
		verdict,
	};
	mkdirSync(dirname(RESULTS_PATH), { recursive: true });
	writeFileSync(RESULTS_PATH, `${JSON.stringify(report, null, 2)}\n`);
	process.stdout.write(
		`\nverdict: ${verdict}\nresults: ${RESULTS_PATH}\ncount: ${flat.length}\n`,
	);
	if (verdict !== "pass") {
		for (const t of flat.filter((t) => t.status === "fail")) {
			process.stderr.write(
				`FAIL ${t.suite} :: ${t.name}: ${t.diagnostics?.error ?? "unknown"}\n`,
			);
		}
		process.exit(1);
	}
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`run-all_fatal:${message}\n`);
	process.exit(1);
});
