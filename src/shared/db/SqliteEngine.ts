/*
 * better-sqlite3-backed Engine (spp-db:CNT-001, spp-db:INV-002). Serialises
 * every op on one queue so a transaction is never interleaved; PRAGMAs per
 * connection.
 */

import type Database from "better-sqlite3";

import type { Dialect, Engine, RunResult, SqlParams, Tx } from "./Engine.ts";

export class SqliteEngine implements Engine {
	readonly dialect: Dialect = "sqlite";
	private readonly db: Database.Database;
	private readonly statements = new Map<string, Database.Statement>();
	private chain: Promise<unknown> = Promise.resolve();

	constructor(db: Database.Database) {
		this.db = db;
		db.pragma("journal_mode = WAL");
		db.pragma("foreign_keys = ON");
		db.pragma("busy_timeout = 5000");
	}

	get<Row>(sql: string, params: SqlParams = []): Promise<Row | undefined> {
		return this.enqueue(() => this.getNow<Row>(sql, params));
	}

	all<Row>(sql: string, params: SqlParams = []): Promise<Row[]> {
		return this.enqueue(() => this.allNow<Row>(sql, params));
	}

	run(sql: string, params: SqlParams = []): Promise<RunResult> {
		return this.enqueue(() => this.runNow(sql, params));
	}

	transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
		return this.enqueue(async () => {
			const tx: Tx = {
				get: <Row>(sql: string, params: SqlParams = []) =>
					Promise.resolve(this.getNow<Row>(sql, params)),
				all: <Row>(sql: string, params: SqlParams = []) =>
					Promise.resolve(this.allNow<Row>(sql, params)),
				run: (sql: string, params: SqlParams = []) =>
					Promise.resolve(this.runNow(sql, params)),
			};
			this.db.exec("BEGIN IMMEDIATE");
			try {
				const out = await fn(tx);
				this.db.exec("COMMIT");
				return out;
			} catch (err) {
				try {
					this.db.exec("ROLLBACK");
				} catch {
					/* no active transaction to roll back */
				}
				throw err;
			}
		});
	}

	isUniqueViolation(err: unknown): boolean {
		if (!(err instanceof Error)) {
			return false;
		}
		const code: unknown = Reflect.get(err, "code");
		if (
			code === "SQLITE_CONSTRAINT_UNIQUE" ||
			code === "SQLITE_CONSTRAINT_PRIMARYKEY"
		) {
			return true;
		}
		return (
			err.message.includes("UNIQUE constraint failed") ||
			err.message.includes("PRIMARY KEY")
		);
	}

	exec(sql: string): Promise<void> {
		return this.enqueue(() => {
			this.db.exec(sql);
		});
	}

	close(): Promise<void> {
		return this.enqueue(() => {
			this.db.close();
		});
	}

	/*
	 * Serialise every op on one promise chain: the next op starts only after the
	 * previous settles. Ops inside a transaction body use the direct *Now helpers,
	 * never enqueue, so they run within the already-queued slot.
	 */
	private enqueue<T>(op: () => Promise<T> | T): Promise<T> {
		const result = this.chain.then(() => op());
		this.chain = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	private prepared(sql: string): Database.Statement {
		let stmt = this.statements.get(sql);
		if (stmt === undefined) {
			stmt = this.db.prepare(sql);
			this.statements.set(sql, stmt);
		}
		return stmt;
	}

	private getNow<Row>(sql: string, params: SqlParams): Row | undefined {
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary: the caller declares the row shape via <Row> */
		return this.prepared(sql).get(...params) as Row | undefined;
	}

	private allNow<Row>(sql: string, params: SqlParams): Row[] {
		/* eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- DB driver boundary: the caller declares the row shape via <Row> */
		return this.prepared(sql).all(...params) as Row[];
	}

	private runNow(sql: string, params: SqlParams): RunResult {
		const written = this.prepared(sql).run(...params);
		return { changes: written.changes };
	}
}
