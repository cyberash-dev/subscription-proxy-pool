/*
 * Engine composition root (spp-db:CNT-001). Opens the configured engine and
 * applies migrations; the Postgres seam dynamically imports `pg` so a
 * SQLite-only deployment never loads the driver.
 */

import Database from "better-sqlite3";

import type { Engine } from "./Engine.ts";
import { SqliteEngine } from "./SqliteEngine.ts";
import { PostgresEngine, type PgPool } from "./PostgresEngine.ts";
import { applyMigrations } from "./Migrations.ts";

export interface SqliteEngineConfig {
	readonly engine: "sqlite";
	readonly path: string;
}

export interface PostgresEngineConfig {
	readonly engine: "postgres";
	readonly connectionString: string;
	readonly poolMax?: number;
}

export type EngineConfig = SqliteEngineConfig | PostgresEngineConfig;

/* Numeric env var, falling back to `fallback` on a missing or non-numeric value. */
function numericEnv(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim().length === 0) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/*
 * Resolve the engine selection from the environment (spp-env). Any value other
 * than `postgres` resolves to SQLite at `dbPath`; `postgres` fails closed
 * without SPP_PG_URL.
 */
export function engineConfigFromEnv(dbPath: string): EngineConfig {
	if (process.env.SPP_ENGINE === "postgres") {
		const url = process.env.SPP_PG_URL ?? "";
		if (url.length === 0) {
			throw new Error(
				"spp_pg_url_required: SPP_ENGINE=postgres but SPP_PG_URL is unset or empty",
			);
		}
		return {
			engine: "postgres",
			connectionString: url,
			poolMax: numericEnv("SPP_PG_POOL_MAX", 10),
		};
	}
	return { engine: "sqlite", path: dbPath };
}

export function openSqliteEngine(path: string): SqliteEngine {
	return new SqliteEngine(new Database(path));
}

async function openPostgresEngine(
	config: PostgresEngineConfig,
): Promise<PostgresEngine> {
	const pg = await import("pg");
	const pool: PgPool = new pg.Pool({
		connectionString: config.connectionString,
		max: config.poolMax ?? 10,
	});
	return new PostgresEngine(pool);
}

/* Open the engine selected by `config` and bring its schema up to date. */
export async function openEngine(config: EngineConfig): Promise<Engine> {
	const engine: Engine =
		config.engine === "sqlite"
			? openSqliteEngine(config.path)
			: await openPostgresEngine(config);
	await applyMigrations(engine);
	return engine;
}
