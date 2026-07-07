#!/usr/bin/env node
/*
 * Coverage ratchet: block the commit if any total coverage metric dropped
 * below the recorded baseline; auto-raise the baseline when coverage improves.
 * Baseline lives in .coverage-baseline.json (committed); current numbers come
 * from c8's coverage/coverage-summary.json (gitignored, produced by
 * `npm run test:coverage`).
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SUMMARY = "coverage/coverage-summary.json";
const BASELINE = ".coverage-baseline.json";
const METRICS = ["lines", "statements", "functions", "branches"];
const EPS = 1e-9;

function fmt(o) {
	return METRICS.map((m) => `${m} ${o[m].toFixed(2)}%`).join(", ");
}

function tryGitAdd() {
	try {
		execSync(`git add ${BASELINE}`, { stdio: "ignore" });
	} catch {
		/* not inside a git context / git unavailable — file stays written */
	}
}

if (!existsSync(SUMMARY)) {
	console.error(
		`coverage ratchet: ${SUMMARY} missing — run \`npm run test:coverage\` first`,
	);
	process.exit(2);
}

const total = JSON.parse(readFileSync(SUMMARY, "utf8")).total;
const current = {};
for (const m of METRICS) {
	const pct = total?.[m]?.pct;
	if (typeof pct !== "number") {
		console.error(`coverage ratchet: missing total.${m}.pct in ${SUMMARY}`);
		process.exit(2);
	}
	current[m] = pct;
}

if (!existsSync(BASELINE)) {
	writeFileSync(BASELINE, `${JSON.stringify(current, null, "\t")}\n`);
	tryGitAdd();
	console.error(`coverage ratchet: initialized baseline — ${fmt(current)}`);
	process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const regressions = [];
const next = {};
let raised = false;
for (const m of METRICS) {
	const base = typeof baseline[m] === "number" ? baseline[m] : 0;
	const cur = current[m];
	if (cur + EPS < base) {
		regressions.push(`${m}: ${base.toFixed(2)}% -> ${cur.toFixed(2)}%`);
	}
	next[m] = Math.max(base, cur);
	if (next[m] > base + EPS) {
		raised = true;
	}
}

if (regressions.length > 0) {
	console.error(
		"coverage ratchet: coverage dropped below baseline — commit blocked:",
	);
	for (const r of regressions) {
		console.error(`  ${r}`);
	}
	console.error(
		`(baseline in ${BASELINE}; intentional drops require git commit -n)`,
	);
	process.exit(1);
}

if (raised) {
	writeFileSync(BASELINE, `${JSON.stringify(next, null, "\t")}\n`);
	tryGitAdd();
	console.error(`coverage ratchet: raised baseline -> ${fmt(next)}`);
} else {
	console.error(`coverage ratchet: held at baseline — ${fmt(baseline)}`);
}
process.exit(0);
