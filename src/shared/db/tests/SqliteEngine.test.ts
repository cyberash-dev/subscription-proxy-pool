/*
 * Engine port coverage on the SQLite backend: serialised ops, atomic
 * transactions, and unique-violation detection.
 *
 * @covers spp-db:CNT-001
 * @covers spp-db:INV-001
 * @covers spp-db:INV-002
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../SqliteEngine.ts";

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

interface Fixture {
	readonly engine: SqliteEngine;
	readonly cleanup: () => void;
}

function mkFixture(): Fixture {
	const dir = mkdtempSync(join(tmpdir(), "spp-engine-"));
	const db = new Database(join(dir, "t.db"));
	const engine = new SqliteEngine(db);
	return {
		engine,
		cleanup: () => {
			try {
				db.close();
			} catch {
				/* ignore */
			}
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

async function testRunGetAll(): Promise<void> {
	const f = mkFixture();
	try {
		await f.engine.exec("CREATE TABLE t(id TEXT PRIMARY KEY, n INTEGER)");
		const inserted = await f.engine.run("INSERT INTO t(id, n) VALUES(?, ?)", [
			"a",
			1,
		]);
		assert(inserted.changes === 1, "one row inserted");
		const row = await f.engine.get<{ n: number }>(
			"SELECT n FROM t WHERE id = ?",
			["a"],
		);
		assert(row?.n === 1, "get returns the row");
		await f.engine.run("INSERT INTO t(id, n) VALUES(?, ?)", ["b", 2]);
		const rows = await f.engine.all<{ id: string }>(
			"SELECT id FROM t ORDER BY id",
		);
		assert(rows.length === 2, "all returns two rows");
	} finally {
		f.cleanup();
	}
}

async function testTransactionRollsBackOnError(): Promise<void> {
	const f = mkFixture();
	try {
		await f.engine.exec("CREATE TABLE t(id TEXT PRIMARY KEY)");
		let threw = false;
		try {
			await f.engine.transaction(async (tx) => {
				await tx.run("INSERT INTO t(id) VALUES(?)", ["x"]);
				throw new Error("boom");
			});
		} catch {
			threw = true;
		}
		assert(threw, "transaction propagates the error");
		const rows = await f.engine.all("SELECT id FROM t");
		assert(rows.length === 0, "row was rolled back");
	} finally {
		f.cleanup();
	}
}

async function testUniqueViolationDetected(): Promise<void> {
	const f = mkFixture();
	try {
		await f.engine.exec("CREATE TABLE t(id TEXT PRIMARY KEY)");
		await f.engine.run("INSERT INTO t(id) VALUES(?)", ["dup"]);
		let caught: unknown;
		try {
			await f.engine.run("INSERT INTO t(id) VALUES(?)", ["dup"]);
		} catch (err) {
			caught = err;
		}
		assert(
			f.engine.isUniqueViolation(caught),
			"unique violation is recognised",
		);
	} finally {
		f.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest("run_get_all_roundtrip", testRunGetAll);
	await runTest(
		"transaction_rolls_back_on_error",
		testTransactionRollsBackOnError,
	);
	await runTest("unique_violation_detected", testUniqueViolationDetected);

	const report = { suite: "SqliteEngine", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
