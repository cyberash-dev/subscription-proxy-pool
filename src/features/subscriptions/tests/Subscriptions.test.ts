/*
 * Subscription management: add to user/donor pools, one-pool invariant, disable,
 * token-free summaries, active-pool listing, and TokenStore compatibility.
 *
 * @covers spp-subscriptions:BEH-001
 * @covers spp-subscriptions:BEH-002
 * @covers spp-subscriptions:BEH-003
 * @covers spp-subscriptions:INV-001
 * @covers spp-subscriptions:CNT-001
 * @covers spp-subscriptions:DLT-001
 * @covers pol:POL-SECRET-001
 */

import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SqliteEngine } from "../../../shared/db/SqliteEngine.ts";
import { applyMigrations } from "../../../shared/db/Migrations.ts";
import { FakeClock } from "../../../shared/domain/Clock.ts";
import type { TokenStore } from "../../subscription-oauth/ports/outbound/TokenStore.ts";
import { SubscriptionsService } from "../application/SubscriptionsService.ts";
import { SqliteSubscriptionRepository } from "../adapters/outbound/SqliteSubscriptionRepository.ts";
import { crypterForTests } from "../../../shared/crypto/tests/crypterForTests.ts";
import type { AddSubscriptionInput } from "../ports/inbound/SubscriptionsPort.ts";

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
	readonly service: SubscriptionsService;
	readonly repo: SqliteSubscriptionRepository;
	readonly engine: SqliteEngine;
	readonly cleanup: () => void;
}

async function mkHarness(): Promise<Harness> {
	const dir = mkdtempSync(join(tmpdir(), "spp-subs-"));
	const db = new Database(join(dir, "pool.db"));
	const engine = new SqliteEngine(db);
	await applyMigrations(engine);
	await engine.run(
		"INSERT INTO users(user_id, created_at) VALUES('user-a', datetime('now'))",
	);
	await engine.run(
		"INSERT INTO users(user_id, created_at) VALUES('user-b', datetime('now'))",
	);
	const repo = new SqliteSubscriptionRepository(engine, crypterForTests());
	/* Compile-time proof: the repo satisfies the subscription-oauth TokenStore. */
	const tokenStore: TokenStore = repo;
	void tokenStore;
	const service = new SubscriptionsService(
		repo,
		new FakeClock(Date.parse("2026-07-04T00:00:00.000Z")),
	);
	return {
		service,
		repo,
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

function anthropicGrant(): Omit<
	AddSubscriptionInput,
	"poolKind" | "ownerUserId"
> {
	return {
		provider: "anthropic",
		label: "test-sub",
		accessToken: "sk-ant-oat-secret",
		refreshToken: "sk-ant-ort-secret",
		tokenExpiresAt: "2030-01-01T00:00:00.000Z",
		scopes: "user:inference",
	};
}

async function testAddToUserPool(): Promise<void> {
	const h = await mkHarness();
	try {
		const added = await h.service.add({
			...anthropicGrant(),
			poolKind: "user",
			ownerUserId: "user-a",
		});
		const stored = await h.repo.findById(added.subscriptionId);
		assert(stored?.poolKind === "user", "stored in user pool");
		assert(stored?.ownerUserId === "user-a", "owner set");
		assert(stored?.status === "active", "active on add");
	} finally {
		h.cleanup();
	}
}

async function testAddToDonorPool(): Promise<void> {
	const h = await mkHarness();
	try {
		const added = await h.service.add({
			...anthropicGrant(),
			poolKind: "donor",
		});
		const stored = await h.repo.findById(added.subscriptionId);
		assert(stored?.poolKind === "donor", "stored in donor pool");
		assert(stored?.ownerUserId === undefined, "no owner on donor subscription");
	} finally {
		h.cleanup();
	}
}

async function testPoolMembershipInvariant(): Promise<void> {
	const h = await mkHarness();
	try {
		let userNoOwnerThrew = false;
		try {
			await h.service.add({ ...anthropicGrant(), poolKind: "user" });
		} catch {
			userNoOwnerThrew = true;
		}
		assert(userNoOwnerThrew, "user pool without owner rejected");

		let donorWithOwnerThrew = false;
		try {
			await h.service.add({
				...anthropicGrant(),
				poolKind: "donor",
				ownerUserId: "user-a",
			});
		} catch {
			donorWithOwnerThrew = true;
		}
		assert(donorWithOwnerThrew, "donor pool with owner rejected");
	} finally {
		h.cleanup();
	}
}

async function testDisableExcludesFromActivePool(): Promise<void> {
	const h = await mkHarness();
	try {
		const added = await h.service.add({
			...anthropicGrant(),
			poolKind: "user",
			ownerUserId: "user-a",
		});
		await h.service.disable("user-a", added.subscriptionId);
		const active = await h.repo.listByPool("user", "user-a", "anthropic");
		assert(
			active.length === 0,
			"disabled subscription excluded from active pool",
		);
	} finally {
		h.cleanup();
	}
}

async function testDisableByNonOwnerRejected(): Promise<void> {
	const h = await mkHarness();
	try {
		const added = await h.service.add({
			...anthropicGrant(),
			poolKind: "user",
			ownerUserId: "user-a",
		});
		let threw = false;
		try {
			await h.service.disable("user-b", added.subscriptionId);
		} catch {
			threw = true;
		}
		assert(threw, "non-owner disable rejected");
	} finally {
		h.cleanup();
	}
}

async function testSummariesOmitTokens(): Promise<void> {
	const h = await mkHarness();
	try {
		await h.service.add({ ...anthropicGrant(), poolKind: "donor" });
		const summaries = await h.service.list({ poolKind: "donor" });
		assert(summaries.length === 1, "one donor subscription listed");
		const summary = summaries[0];
		assert(
			!Object.prototype.hasOwnProperty.call(summary, "accessToken"),
			"no access token",
		);
		assert(
			!Object.prototype.hasOwnProperty.call(summary, "refreshToken"),
			"no refresh token",
		);
	} finally {
		h.cleanup();
	}
}

async function testTokensEncryptedAtRest(): Promise<void> {
	const h = await mkHarness();
	try {
		const added = await h.service.add({
			...anthropicGrant(),
			poolKind: "donor",
		});

		const raw = await h.engine.get<{
			access_token: string;
			refresh_token: string;
		}>(
			"SELECT access_token, refresh_token FROM subscriptions WHERE subscription_id = ?",
			[added.subscriptionId],
		);
		if (raw === undefined) {
			throw new Error("row present");
		}
		assert(
			raw.access_token.startsWith("v1."),
			"access token stored as ciphertext",
		);
		assert(
			raw.access_token !== "sk-ant-oat-secret",
			"access token not plaintext at rest",
		);
		assert(
			raw.refresh_token.startsWith("v1."),
			"refresh token stored as ciphertext",
		);

		const stored = await h.repo.findById(added.subscriptionId);
		assert(
			stored?.accessToken === "sk-ant-oat-secret",
			"decrypts to original access token",
		);
		assert(
			stored?.refreshToken === "sk-ant-ort-secret",
			"decrypts to original refresh token",
		);
	} finally {
		h.cleanup();
	}
}

async function testActiveListFiltersByProvider(): Promise<void> {
	const h = await mkHarness();
	try {
		const anthropic = await h.service.add({
			...anthropicGrant(),
			poolKind: "donor",
		});
		await h.service.add({
			...anthropicGrant(),
			provider: "openai",
			accessToken: "openai-access",
			refreshToken: "openai-refresh",
			poolKind: "donor",
		});

		const active = await h.repo.listActive("anthropic");

		assert(active.length === 1, "only one Anthropic subscription is active");
		assert(
			active[0]?.subscriptionId === anthropic.subscriptionId,
			"OpenAI subscription is excluded from Anthropic active list",
		);
	} finally {
		h.cleanup();
	}
}

async function main(): Promise<void> {
	await runTest("add_to_user_pool", testAddToUserPool);
	await runTest("add_to_donor_pool", testAddToDonorPool);
	await runTest("pool_membership_invariant", testPoolMembershipInvariant);
	await runTest(
		"disable_excludes_from_active_pool",
		testDisableExcludesFromActivePool,
	);
	await runTest("disable_by_non_owner_rejected", testDisableByNonOwnerRejected);
	await runTest("summaries_omit_tokens", testSummariesOmitTokens);
	await runTest("tokens_encrypted_at_rest", testTokensEncryptedAtRest);
	await runTest(
		"active_list_filters_by_provider",
		testActiveListFiltersByProvider,
	);

	const report = { suite: "Subscriptions", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
