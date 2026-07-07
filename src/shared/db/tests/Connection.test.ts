/*
 * Engine composition root: env-driven engine selection and SQLite open+migrate.
 *
 * @covers spp-db:CNST-001
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { engineConfigFromEnv, openEngine } from "../Connection.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(
	name: string,
	fn: () => Promise<void> | void,
): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): void {
	if (!cond) {
		throw new Error(label);
	}
}

function testSqliteByDefault(): void {
	delete process.env.SPP_ENGINE;
	const config = engineConfigFromEnv("/tmp/x.db");
	assert(config.engine === "sqlite", "defaults to sqlite");
	assert(
		config.engine === "sqlite" && config.path === "/tmp/x.db",
		"path carried",
	);
}

function testPostgresRequiresUrl(): void {
	process.env.SPP_ENGINE = "postgres";
	delete process.env.SPP_PG_URL;
	let threw = false;
	try {
		engineConfigFromEnv("/tmp/x.db");
	} catch {
		threw = true;
	}
	assert(threw, "postgres without SPP_PG_URL fails closed");

	process.env.SPP_PG_URL = "postgres://localhost/db";
	const config = engineConfigFromEnv("/tmp/x.db");
	assert(config.engine === "postgres", "postgres selected when url present");
	delete process.env.SPP_ENGINE;
	delete process.env.SPP_PG_URL;
}

async function testOpenEngineAppliesMigrations(): Promise<void> {
	delete process.env.SPP_ENGINE;
	const dir = mkdtempSync(join(tmpdir(), "spp-conn-"));
	try {
		const engine = await openEngine({
			engine: "sqlite",
			path: join(dir, "pool.db"),
		});
		const row = await engine.get<{ v: number }>(
			"SELECT MAX(version) AS v FROM schema_version",
		);
		assert(row?.v === 1, "migrations applied on open");
		await engine.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	await runTest("sqlite_by_default", () => {
		testSqliteByDefault();
	});
	await runTest("postgres_requires_url", () => {
		testPostgresRequiresUrl();
	});
	await runTest(
		"open_engine_applies_migrations",
		testOpenEngineAppliesMigrations,
	);

	const report = { suite: "Connection", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
