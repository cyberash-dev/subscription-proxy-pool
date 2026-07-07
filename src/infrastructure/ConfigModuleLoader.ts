/*
 * Loads the SPP_CONFIG module and resolves the engine selection it optionally
 * carries, shared by both composition roots (HTTP server and CLI) so a
 * database() hook in spp.conf.ts governs every entrypoint (spp-db:CNT-002).
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	engineConfigFromEnv,
	type EngineConfig,
} from "../shared/db/Connection.ts";
import type { SppConfigModule } from "./SppConfigModule.ts";

export async function loadSppConfigModule(
	configModulePath: string | undefined,
): Promise<SppConfigModule | undefined> {
	if (configModulePath === undefined) {
		return undefined;
	}
	const href = pathToFileURL(resolve(configModulePath)).href;
	let loaded: unknown;
	try {
		loaded = await import(href);
	} catch (cause) {
		throw new Error(`config_module_load_failed:${configModulePath}`, { cause });
	}
	const configModule =
		loaded !== null && typeof loaded === "object" && "default" in loaded
			? loaded.default
			: undefined;
	if (!isSppConfigModule(configModule)) {
		throw new Error(`config_module_bad_shape:${configModulePath}`);
	}
	return configModule;
}

export function resolveEngineConfig(
	configModule: SppConfigModule | undefined,
	dbPath: string,
): EngineConfig {
	return configModule?.database?.() ?? engineConfigFromEnv(dbPath);
}

function isSppConfigModule(value: unknown): value is SppConfigModule {
	if (value === null || typeof value !== "object") {
		return false;
	}
	if (
		"identityProviders" in value &&
		typeof value.identityProviders !== "function"
	) {
		return false;
	}
	if ("database" in value && typeof value.database !== "function") {
		return false;
	}
	return true;
}
