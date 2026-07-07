#!/usr/bin/env node
/*
 * CLI entrypoint (spp-cli@1). Admin-only surface: bootstrap + operation. Most
 * user-facing flows live on the management HTTP API. Dispatch on argv[2].
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";

import { loadConfig } from "../shared/config/Env.ts";
import { systemClock } from "../shared/domain/Clock.ts";
import { newUuid } from "../shared/domain/Scalars.ts";
import { openEngine } from "../shared/db/Connection.ts";
import type { Engine } from "../shared/db/Engine.ts";
import { AccessKeysService } from "../features/access-keys/application/AccessKeysService.ts";
import { SqliteProxyKeyRepository } from "../features/access-keys/adapters/outbound/SqliteProxyKeyRepository.ts";
import { Server } from "../infrastructure/Server.ts";
import {
	loadSppConfigModule,
	resolveEngineConfig,
} from "../infrastructure/ConfigModuleLoader.ts";

function flag(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}

function requireFlag(name: string): string {
	const value = flag(name);
	if (value === undefined) {
		throw new Error(`missing required flag: ${name}`);
	}
	return value;
}

async function openConfiguredEngine(): Promise<{
	engine: Engine;
	dbPath: string;
}> {
	const config = loadConfig();
	mkdirSync(config.home, { recursive: true, mode: 0o700 });
	const configModule = await loadSppConfigModule(config.configModulePath);
	const engineConfig = resolveEngineConfig(configModule, config.dbPath);
	const engine = await openEngine(engineConfig);
	if (engineConfig.engine === "sqlite" && existsSync(engineConfig.path)) {
		chmodSync(engineConfig.path, config.dbFileMode);
	}
	return { engine, dbPath: config.dbPath };
}

async function migrate(): Promise<void> {
	const { engine, dbPath } = await openConfiguredEngine();
	await engine.close();
	process.stdout.write(`migrated: ${dbPath}\n`);
}

async function serve(): Promise<void> {
	const server = new Server(loadConfig());
	await server.start();
	const shutdown = (): void => {
		void server.stop().then(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

async function adminUserCreate(): Promise<void> {
	const { engine } = await openConfiguredEngine();
	try {
		const userId = newUuid();
		await engine.run(
			"INSERT INTO users(user_id, handle, created_at) VALUES(?, ?, ?)",
			[userId, flag("--handle") ?? null, systemClock.nowIso()],
		);
		process.stdout.write(`user_id: ${userId}\n`);
	} finally {
		await engine.close();
	}
}

async function adminKeyIssue(): Promise<void> {
	const { engine } = await openConfiguredEngine();
	try {
		const poolTarget = requireFlag("--pool");
		if (poolTarget !== "own" && poolTarget !== "donor") {
			throw new Error("--pool must be 'own' or 'donor'");
		}
		const service = new AccessKeysService(
			new SqliteProxyKeyRepository(engine),
			systemClock,
		);
		const issued = await service.issueKey(requireFlag("--user"), poolTarget);
		process.stdout.write(`key_id: ${issued.keyId}\nsecret: ${issued.secret}\n`);
	} finally {
		await engine.close();
	}
}

async function main(): Promise<void> {
	const command = process.argv[2];
	switch (command) {
		case "migrate":
			await migrate();
			return;
		case "serve":
			await serve();
			return;
		case "admin": {
			const sub = process.argv[3];
			if (sub === "user-create") {
				await adminUserCreate();
				return;
			}
			if (sub === "key-issue") {
				await adminKeyIssue();
				return;
			}
			throw new Error(`unknown admin subcommand: ${sub ?? "(none)"}`);
		}
		default:
			process.stderr.write(
				`unknown command: ${command ?? "(none)"}\n` +
					"usage: spp <migrate|serve|admin user-create|admin key-issue>\n",
			);
			process.exit(1);
	}
}

main().catch((err: unknown) => {
	const message =
		err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(`cli_fatal:${message}\n`);
	process.exit(1);
});
