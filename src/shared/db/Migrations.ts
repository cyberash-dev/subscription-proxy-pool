/*
 * Forward-only, dialect-aware async migration runner (spp-db:CNST-001). Same
 * version numbers per engine; SQLite set = migrations/, Postgres set =
 * migrations/postgres/. Each migration file owns its own
 * `INSERT INTO schema_version` row. Never edit an applied migration.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Dialect, Engine } from "./Engine.ts";

interface Migration {
	readonly version: number;
	readonly filename: string;
	readonly sql: string;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
/* shared/db/Migrations.ts → ../../../migrations */
const migrationsRoot = join(moduleDir, "..", "..", "..", "migrations");

const MIGRATION_FILES: ReadonlyArray<{
	readonly version: number;
	readonly filename: string;
}> = [{ version: 1, filename: "001-initial.sql" }];

function migrationDir(dialect: Dialect): string {
	return dialect === "postgres"
		? join(migrationsRoot, "postgres")
		: migrationsRoot;
}

export function migrationsFor(dialect: Dialect): readonly Migration[] {
	const dir = migrationDir(dialect);
	return MIGRATION_FILES.map((file) => ({
		version: file.version,
		filename: file.filename,
		sql: readFileSync(join(dir, file.filename), "utf8"),
	}));
}

async function schemaVersionTableExists(engine: Engine): Promise<boolean> {
	if (engine.dialect === "sqlite") {
		const row = await engine.get<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
		);
		return row !== undefined;
	}
	const row = await engine.get(
		"SELECT 1 AS present FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_version' LIMIT 1",
	);
	return row !== undefined;
}

async function currentSchemaVersion(engine: Engine): Promise<number> {
	if (!(await schemaVersionTableExists(engine))) {
		return 0;
	}
	const row = await engine.get<{ v: number | null }>(
		"SELECT MAX(version) AS v FROM schema_version",
	);
	return row?.v ?? 0;
}

/* Apply every migration newer than the recorded schema_version. Idempotent. */
export async function applyMigrations(engine: Engine): Promise<void> {
	const applied = await currentSchemaVersion(engine);
	for (const migration of migrationsFor(engine.dialect)) {
		if (migration.version <= applied) {
			continue;
		}
		await engine.exec(migration.sql);
	}
}
