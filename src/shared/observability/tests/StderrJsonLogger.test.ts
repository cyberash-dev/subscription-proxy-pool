/*
 * StderrJsonLogger: one JSON line per event carrying ts/level/event and the
 * merged flat fields, terminated by a newline.
 */

import { FakeClock } from "../../domain/Clock.ts";
import { StderrJsonLogger } from "../StderrJsonLogger.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): asserts cond {
	if (!cond) {
		throw new Error(label);
	}
}

async function testEmitsOneJsonLinePerEvent(): Promise<void> {
	const lines: string[] = [];
	const logger = new StderrJsonLogger(
		new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
		(line) => lines.push(line),
	);

	logger.log("warn", "SUBSCRIPTION_VERIFY", {
		provider: "openai",
		verdict: "inconclusive",
		status: 403,
	});

	assert(lines.length === 1, "one line per event");
	const line = lines[0];
	assert(line !== undefined, "line captured");
	assert(line.endsWith("\n"), "newline-terminated");
	assert(line.includes('"level":"warn"'), "level serialised");
	assert(line.includes('"event":"SUBSCRIPTION_VERIFY"'), "event serialised");
	assert(line.includes('"provider":"openai"'), "string field merged");
	assert(line.includes('"verdict":"inconclusive"'), "verdict field merged");
	assert(line.includes('"status":403'), "numeric field merged");
	assert(line.includes('"ts":"2026-07-04T00:00:00.000Z"'), "clock timestamp");
}

async function main(): Promise<void> {
	await runTest("emits_one_json_line_per_event", testEmitsOneJsonLinePerEvent);

	const report = { suite: "StderrJsonLogger", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
