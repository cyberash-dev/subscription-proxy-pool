/*
 * Proxy-key issuance + inference-time resolution.
 *
 * @covers spp-access-keys:BEH-001
 * @covers spp-access-keys:BEH-002
 * @covers spp-access-keys:BEH-003
 * @covers spp-access-keys:INV-001
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import { AccessKeysService } from "../application/AccessKeysService.ts";
import { SqliteProxyKeyRepository } from "../adapters/outbound/SqliteProxyKeyRepository.ts";

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

interface Harness {
	readonly service: AccessKeysService;
	readonly engine: SqliteEngine;
	readonly cleanup: () => void;
}

async function mkHarness(): Promise<Harness> {
	const dir = mkdtempSync(join(tmpdir(), "spp-keys-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	for (const userId of ["user-a", "user-b"]) {
		await engine.run(
			"INSERT INTO users(user_id, created_at) VALUES(?, datetime('now'))",
			[userId],
		);
	}
	const service = new AccessKeysService(
		new SqliteProxyKeyRepository(engine),
		new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
	);
	return {
		service,
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

async function testIssueReturnsSecretAndStoresHash(): Promise<void> {
	const h = await mkHarness();
	try {
		const issued = await h.service.issueKey("user-a", "own");
		assert(issued.secret.startsWith("spp_pk_"), "secret has readable prefix");
		const row = await h.engine.get<{ key_hash: string }>(
			"SELECT key_hash FROM proxy_keys WHERE key_id = ?",
			[issued.keyId],
		);
		assert(row !== undefined, "row persisted");
		assert(row?.key_hash !== issued.secret, "plaintext secret is not stored");
		const principal = await h.service.resolvePrincipal(issued.secret);
		assert(principal?.userId === "user-a", "resolves to the issuing user");
		assert(principal?.poolTarget === "own", "resolves to the bound pool");
	} finally {
		h.cleanup();
	}
}

async function testResolveRejectsUnknownAndRevoked(): Promise<void> {
	const h = await mkHarness();
	try {
		assert(
			(await h.service.resolvePrincipal("spp_pk_bogus")) === undefined,
			"unknown key rejected",
		);
		const issued = await h.service.issueKey("user-a", "donor");
		await h.service.revokeKey("user-a", issued.keyId);
		assert(
			(await h.service.resolvePrincipal(issued.secret)) === undefined,
			"revoked key rejected",
		);
	} finally {
		h.cleanup();
	}
}

async function testRevokeByNonOwnerRejected(): Promise<void> {
	const h = await mkHarness();
	try {
		const issued = await h.service.issueKey("user-a", "own");
		let threw = false;
		try {
			await h.service.revokeKey("user-b", issued.keyId);
		} catch {
			threw = true;
		}
		assert(threw, "non-owner revoke rejected");
		assert(
			(await h.service.resolvePrincipal(issued.secret)) !== undefined,
			"key still active after rejected revoke",
		);
	} finally {
		h.cleanup();
	}
}

async function testListKeysOmitsSecret(): Promise<void> {
	const h = await mkHarness();
	try {
		await h.service.issueKey("user-a", "own");
		await h.service.issueKey("user-a", "donor");
		const summaries = await h.service.listKeys("user-a");
		assert(summaries.length === 2, "two keys listed");
		assert(
			!summaries.some((s) => Object.prototype.hasOwnProperty.call(s, "secret")),
			"summaries carry no secret",
		);
	} finally {
		h.cleanup();
	}
}

async function testDistinctPoolPerKey(): Promise<void> {
	const h = await mkHarness();
	try {
		const own = await h.service.issueKey("user-a", "own");
		const donor = await h.service.issueKey("user-a", "donor");
		assert(
			(await h.service.resolvePrincipal(own.secret))?.poolTarget === "own",
			"own key → own pool",
		);
		assert(
			(await h.service.resolvePrincipal(donor.secret))?.poolTarget === "donor",
			"donor key → donor pool",
		);
	} finally {
		h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest(
		"issue_returns_secret_and_stores_hash",
		testIssueReturnsSecretAndStoresHash,
	);
	await runTest(
		"resolve_rejects_unknown_and_revoked",
		testResolveRejectsUnknownAndRevoked,
	);
	await runTest("revoke_by_non_owner_rejected", testRevokeByNonOwnerRejected);
	await runTest("list_keys_omits_secret", testListKeysOmitsSecret);
	await runTest("distinct_pool_per_key", testDistinctPoolPerKey);

	const report = { suite: "AccessKeys", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
