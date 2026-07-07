/*
 * PostgreSQL-backed Engine — the declared multi-dialect seam (spp-db:CNST-001).
 * Not exercised in M1 (SQLite is the working backend); it exists so a future
 * Postgres store needs no repository change. Repositories write `?`-placeholder
 * SQL; this engine rewrites `?` → `$n` at the driver boundary.
 */

import type { Engine, RunResult, SqlParams, Tx } from "./Engine.ts";

/* Minimal structural view of the `pg` types we touch (avoids a hard import). */
export interface PgQueryResult {
	readonly rows: unknown[];
	readonly rowCount: number | null;
}

export interface PgClient {
	query(sql: string, params?: ReadonlyArray<unknown>): Promise<PgQueryResult>;
	release(): void;
}

export interface PgPool {
	query(sql: string, params?: ReadonlyArray<unknown>): Promise<PgQueryResult>;
	connect(): Promise<PgClient>;
	end(): Promise<void>;
}

function toDollar(sql: string): string {
	let index = 0;
	return sql.replace(/\?/g, () => `$${++index}`);
}

async function runQuery(
	runner: { query: PgPool["query"] },
	sql: string,
	params: SqlParams,
): Promise<PgQueryResult> {
	return runner.query(toDollar(sql), params);
}

export class PostgresEngine implements Engine {
	readonly dialect = "postgres" as const;

	constructor(private readonly pool: PgPool) {}

	async get<Row>(
		sql: string,
		params: SqlParams = [],
	): Promise<Row | undefined> {
		const result = await runQuery(this.pool, sql, params);
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary: caller declares <Row> */
		return result.rows[0] as Row | undefined;
	}

	async all<Row>(sql: string, params: SqlParams = []): Promise<Row[]> {
		const result = await runQuery(this.pool, sql, params);
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary: caller declares <Row> */
		return result.rows as Row[];
	}

	async run(sql: string, params: SqlParams = []): Promise<RunResult> {
		const result = await runQuery(this.pool, sql, params);
		return { changes: result.rowCount ?? 0 };
	}

	async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
		const client = await this.pool.connect();
		const tx: Tx = {
			get: async <Row>(sql: string, params: SqlParams = []) => {
				const result = await runQuery(client, sql, params);
				/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary */
				return result.rows[0] as Row | undefined;
			},
			all: async <Row>(sql: string, params: SqlParams = []) => {
				const result = await runQuery(client, sql, params);
				/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary */
				return result.rows as Row[];
			},
			run: async (sql: string, params: SqlParams = []) => {
				const result = await runQuery(client, sql, params);
				return { changes: result.rowCount ?? 0 };
			},
		};
		try {
			await client.query("BEGIN");
			const out = await fn(tx);
			await client.query("COMMIT");
			return out;
		} catch (err) {
			try {
				await client.query("ROLLBACK");
			} catch {
				/* no active transaction to roll back */
			}
			throw err;
		} finally {
			client.release();
		}
	}

	isUniqueViolation(err: unknown): boolean {
		if (!(err instanceof Error)) {
			return false;
		}
		/* SQLSTATE 23505 = unique_violation. */
		return Reflect.get(err, "code") === "23505";
	}

	async exec(sql: string): Promise<void> {
		await this.pool.query(sql);
	}

	async close(): Promise<void> {
		await this.pool.end();
	}
}
