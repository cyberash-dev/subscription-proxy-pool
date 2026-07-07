/*
 * Schema migration coverage: the initial migration creates every table, index
 * and CHECK the slices depend on.
 *
 * @covers spp-db:CNST-001
 * @covers spp-db:CNT-001
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../SqliteEngine.ts";
import { applyMigrations, migrationsFor } from "../Migrations.ts";

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
	readonly db: Database.Database;
	readonly engine: SqliteEngine;
	readonly cleanup: () => void;
}

async function mkFixture(): Promise<Fixture> {
	const dir = mkdtempSync(join(tmpdir(), "spp-migrations-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	return {
		db,
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

function tableExists(db: Database.Database, name: string): boolean {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
		.get(name);
	return row !== undefined;
}

function indexExists(db: Database.Database, name: string): boolean {
	const row = db
		.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?")
		.get(name);
	return row !== undefined;
}

async function testAllTablesPresent(): Promise<void> {
	const f = await mkFixture();
	try {
		for (const table of [
			"schema_version",
			"users",
			"user_identities",
			"auth_sessions",
			"proxy_keys",
			"subscriptions",
			"subscription_load",
			"pkce_sessions",
		]) {
			assert(tableExists(f.db, table), `table ${table} exists`);
		}
	} finally {
		f.cleanup();
	}
}

async function testIndicesPresent(): Promise<void> {
	const f = await mkFixture();
	try {
		for (const index of [
			"idx_proxy_keys_user",
			"idx_subs_userpool",
			"idx_subs_donorpool",
			"idx_load_latest",
			"idx_auth_sessions_user",
			"idx_user_identities_user",
		]) {
			assert(indexExists(f.db, index), `index ${index} exists`);
		}
	} finally {
		f.cleanup();
	}
}

async function testPoolMembershipCheckRejectsDonorWithOwner(): Promise<void> {
	const f = await mkFixture();
	try {
		f.db
			.prepare(
				"INSERT INTO users(user_id, created_at) VALUES('u1', datetime('now'))",
			)
			.run();
		let rejected = false;
		try {
			f.db
				.prepare(
					`INSERT INTO subscriptions(subscription_id, provider, pool_kind, owner_user_id,
					   status, access_token, refresh_token, token_expires_at, scopes, created_at, updated_at)
					 VALUES('s1','anthropic','donor','u1','active','a','r','2030-01-01','x',datetime('now'),datetime('now'))`,
				)
				.run();
		} catch {
			rejected = true;
		}
		assert(
			rejected,
			"donor subscription with owner_user_id is rejected by CHECK",
		);
	} finally {
		f.cleanup();
	}
}

async function testApplyMigrationsIsIdempotent(): Promise<void> {
	const f = await mkFixture();
	try {
		await applyMigrations(f.engine);
		const row = f.db
			.prepare("SELECT MAX(version) AS v FROM schema_version")
			.get() as {
			v: number;
		};
		assert(row.v === 1, "schema_version stays at 1 after re-apply");
	} finally {
		f.cleanup();
	}
}

function testPostgresMigrationSetIsComplete(): void {
	const postgres = migrationsFor("postgres");

	assert(postgres.length === 1, "one postgres migration at version 1");
	const sql = postgres[0].sql;
	for (const table of [
		"schema_version",
		"users",
		"user_identities",
		"auth_sessions",
		"proxy_keys",
		"subscriptions",
		"subscription_load",
		"pkce_sessions",
	]) {
		assert(
			sql.includes(`CREATE TABLE ${table}`),
			`postgres migration creates ${table}`,
		);
	}
	assert(
		sql.includes("INSERT INTO schema_version"),
		"postgres migration records its schema_version row",
	);
	assert(
		!sql.includes("PRAGMA") && !sql.includes("datetime("),
		"postgres migration carries no SQLite-only dialect (PRAGMA / datetime())",
	);
}

async function main(): Promise<void> {
	await runTest("all_tables_present", testAllTablesPresent);
	await runTest("indices_present", testIndicesPresent);
	await runTest(
		"pool_membership_check_rejects_donor_with_owner",
		testPoolMembershipCheckRejectsDonorWithOwner,
	);
	await runTest(
		"apply_migrations_is_idempotent",
		testApplyMigrationsIsIdempotent,
	);
	await runTest("postgres_migration_set_is_complete", () =>
		Promise.resolve(testPostgresMigrationSetIsComplete()),
	);

	const report = { suite: "Migrations", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
