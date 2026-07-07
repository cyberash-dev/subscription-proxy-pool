/*
 * Async database abstraction (spp-db:CNT-001/INV-001/INV-002). Repositories
 * speak this `?`-placeholder contract; SqliteEngine/PostgresEngine implement it.
 */

export type Dialect = "sqlite" | "postgres";

export type SqlParam = string | number | bigint | null;
export type SqlParams = ReadonlyArray<SqlParam>;

export interface RunResult {
	/* Affected-row count — replaces better-sqlite3 `.changes` / pg `rowCount`. */
	readonly changes: number;
}

export interface QueryHandle {
	get<Row>(sql: string, params?: SqlParams): Promise<Row | undefined>;
	all<Row>(sql: string, params?: SqlParams): Promise<Row[]>;
	run(sql: string, params?: SqlParams): Promise<RunResult>;
}

/* A handle pinned to one connection for the duration of a transaction. */
export type Tx = QueryHandle;

export interface Engine extends QueryHandle {
	readonly dialect: Dialect;
	/*
	 * Run `fn` inside one atomic, serialised transaction. The body MUST await
	 * only `tx` operations — no foreign I/O, process spawn, or timer between
	 * BEGIN and COMMIT (spp-db:INV-002).
	 */
	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
	/* True when `err` is a UNIQUE / PRIMARY-KEY violation on this engine. */
	isUniqueViolation(err: unknown): boolean;
	/* Run a multi-statement, parameter-free SQL script (migrations). */
	exec(sql: string): Promise<void>;
	close(): Promise<void>;
}
