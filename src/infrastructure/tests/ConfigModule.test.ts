/*
 * Config-module identity-provider injection seam: a provider from the SPP_CONFIG
 * module's default export is merged into the registry and resolves via
 * beginLogin; without SPP_CONFIG the registry is SPP_OIDC_* only.
 *
 * @covers spp-auth:CNT-002
 * @covers spp-db:CNT-002
 * @covers spp-db:BEH-001
 */

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../../shared/config/Env.ts";
import { Server, type WiredApp } from "../Server.ts";
import { resolveEngineConfig } from "../ConfigModuleLoader.ts";

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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const STUB_CONFIG_PATH = join(TEST_DIR, "_stub-config-module.ts");
const STUB_DB_CONFIG_PATH = join(TEST_DIR, "_stub-db-config-module.ts");
const STUB_BADDB_CONFIG_PATH = join(TEST_DIR, "_stub-baddb-config-module.ts");

function clearSppEnv(): void {
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("SPP_")) {
			delete process.env[key];
		}
	}
}

interface WiredHarness {
	readonly app: WiredApp;
	readonly cleanup: () => Promise<void>;
}

async function wireWith(configPath: string | undefined): Promise<WiredHarness> {
	const dir = mkdtempSync(join(tmpdir(), "spp-cfg-"));
	clearSppEnv();
	process.env.SPP_HOME = dir;
	process.env.SPP_TOKEN_CRYPT_KEYS = `1:${Buffer.alloc(32, 7).toString("base64")}`;
	if (configPath !== undefined) {
		process.env.SPP_CONFIG = configPath;
	}
	const server = new Server(loadConfig());
	const app = await server.wire();
	return {
		app,
		cleanup: async () => {
			await server.stop();
			rmSync(dir, { recursive: true, force: true });
			clearSppEnv();
		},
	};
}

async function testConfigModuleProviderIsSelectable(): Promise<void> {
	const harness = await wireWith(STUB_CONFIG_PATH);

	try {
		const begun = await harness.app.auth.beginLogin({
			provider: "stub-provider",
		});

		assert(
			begun.authorizeUrl.startsWith("https://stub.test/authorize"),
			"config-module provider resolves through beginLogin",
		);
	} finally {
		await harness.cleanup();
	}
}

async function testAbsentConfigLeavesOidcOnly(): Promise<void> {
	const harness = await wireWith(undefined);

	try {
		let threw = false;
		try {
			await harness.app.auth.beginLogin({ provider: "stub-provider" });
		} catch {
			threw = true;
		}

		assert(threw, "without SPP_CONFIG the stub provider is not registered");
	} finally {
		await harness.cleanup();
	}
}

async function testConfigModuleDatabaseOverridesEnv(): Promise<void> {
	const harness = await wireWith(STUB_DB_CONFIG_PATH);

	try {
		const home = process.env.SPP_HOME ?? "";
		assert(
			existsSync(join(home, "override.db")),
			"engine opened at the module-selected sqlite path",
		);
		assert(
			!existsSync(join(home, "pool.db")),
			"env-default pool.db not used when database() overrides",
		);
		assert(
			harness.app.engine.dialect === "sqlite",
			"module-selected engine is sqlite",
		);

		const row = await harness.app.engine.get<{ v: number }>(
			"SELECT MAX(version) AS v FROM schema_version",
		);
		assert(row?.v === 1, "migrations applied on the module-selected engine");
	} finally {
		await harness.cleanup();
	}
}

async function testConfigModuleBadDatabaseShapeRejected(): Promise<void> {
	const dir = mkdtempSync(join(tmpdir(), "spp-cfg-"));
	clearSppEnv();
	process.env.SPP_HOME = dir;
	process.env.SPP_TOKEN_CRYPT_KEYS = `1:${Buffer.alloc(32, 7).toString("base64")}`;
	process.env.SPP_CONFIG = STUB_BADDB_CONFIG_PATH;

	try {
		let error: unknown;
		try {
			await new Server(loadConfig()).wire();
		} catch (err) {
			error = err;
		}

		assert(
			error instanceof Error,
			"wire rejects a non-function database member",
		);
		assert(
			error instanceof Error &&
				error.message.includes("config_module_bad_shape"),
			"error tag is config_module_bad_shape",
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		clearSppEnv();
	}
}

function testResolveEngineConfigPrefersModule(): void {
	delete process.env.SPP_ENGINE;
	delete process.env.SPP_PG_URL;

	const fromModule = resolveEngineConfig(
		{
			database: () => ({
				engine: "postgres",
				connectionString: "postgres://x/y",
			}),
		},
		"/tmp/pool.db",
	);
	const fromEnv = resolveEngineConfig(undefined, "/tmp/pool.db");

	assert(fromModule.engine === "postgres", "module database() wins over env");
	assert(
		fromEnv.engine === "sqlite" && fromEnv.path === "/tmp/pool.db",
		"absent database() falls back to env engine selection",
	);
}

async function main(): Promise<void> {
	await runTest(
		"config_module_provider_is_selectable",
		testConfigModuleProviderIsSelectable,
	);
	await runTest(
		"absent_config_leaves_oidc_only",
		testAbsentConfigLeavesOidcOnly,
	);
	await runTest(
		"config_module_database_overrides_env",
		testConfigModuleDatabaseOverridesEnv,
	);
	await runTest(
		"config_module_bad_database_shape_rejected",
		testConfigModuleBadDatabaseShapeRejected,
	);
	await runTest(
		"resolve_engine_config_prefers_module_over_env",
		testResolveEngineConfigPrefersModule,
	);

	const report = { suite: "ConfigModule", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

void main();
