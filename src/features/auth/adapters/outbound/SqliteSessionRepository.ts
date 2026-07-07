/* SQLite adapter for management-API sessions (spp-auth). Secret stored hashed. */

import type { Engine } from "../../../../shared/db/Engine.ts";
import type {
	SessionRepository,
	StoredSession,
} from "../../ports/outbound/Repositories.ts";

interface Row {
	readonly session_id: string;
	readonly session_hash: string;
	readonly user_id: string;
	readonly created_at: string;
	readonly expires_at: string;
	readonly revoked_at: string | null;
}

function toSession(row: Row): StoredSession {
	return {
		sessionId: row.session_id,
		sessionHash: row.session_hash,
		userId: row.user_id,
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at ?? undefined,
	};
}

export class SqliteSessionRepository implements SessionRepository {
	constructor(private readonly engine: Engine) {}

	async insert(session: StoredSession): Promise<void> {
		await this.engine.run(
			`INSERT INTO auth_sessions(session_id, session_hash, user_id, created_at, expires_at, revoked_at)
			 VALUES(?, ?, ?, ?, ?, NULL)`,
			[
				session.sessionId,
				session.sessionHash,
				session.userId,
				session.createdAt,
				session.expiresAt,
			],
		);
	}

	async findByHash(sessionHash: string): Promise<StoredSession | undefined> {
		const row = await this.engine.get<Row>(
			"SELECT * FROM auth_sessions WHERE session_hash = ?",
			[sessionHash],
		);
		return row === undefined ? undefined : toSession(row);
	}

	async revoke(sessionId: string, revokedAt: string): Promise<void> {
		await this.engine.run(
			"UPDATE auth_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL",
			[revokedAt, sessionId],
		);
	}
}
