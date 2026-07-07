/* SQLite adapter for user accounts + external-identity links (spp-auth). */

import type { Engine } from "../../../../shared/db/Engine.ts";
import type { User, UserIdentity } from "../../domain/User.ts";
import type {
	UserIdentityRepository,
	UserRepository,
} from "../../ports/outbound/Repositories.ts";

interface UserRow {
	readonly user_id: string;
	readonly handle: string | null;
	readonly created_at: string;
}

interface IdentityRow {
	readonly identity_id: string;
	readonly user_id: string;
	readonly issuer: string;
	readonly subject: string;
	readonly email: string | null;
	readonly linked_at: string;
}

export class SqliteUserRepository implements UserRepository {
	constructor(private readonly engine: Engine) {}

	async insert(user: User): Promise<void> {
		await this.engine.run(
			"INSERT INTO users(user_id, handle, created_at) VALUES(?, ?, ?)",
			[user.userId, user.handle ?? null, user.createdAt],
		);
	}

	async findById(userId: string): Promise<User | undefined> {
		const row = await this.engine.get<UserRow>(
			"SELECT user_id, handle, created_at FROM users WHERE user_id = ?",
			[userId],
		);
		if (row === undefined) {
			return undefined;
		}
		return {
			userId: row.user_id,
			handle: row.handle ?? undefined,
			createdAt: row.created_at,
		};
	}
}

export class SqliteUserIdentityRepository implements UserIdentityRepository {
	constructor(private readonly engine: Engine) {}

	async findByExternal(
		issuer: string,
		subject: string,
	): Promise<UserIdentity | undefined> {
		const row = await this.engine.get<IdentityRow>(
			"SELECT * FROM user_identities WHERE issuer = ? AND subject = ?",
			[issuer, subject],
		);
		if (row === undefined) {
			return undefined;
		}
		return {
			identityId: row.identity_id,
			userId: row.user_id,
			issuer: row.issuer,
			subject: row.subject,
			email: row.email ?? undefined,
			linkedAt: row.linked_at,
		};
	}

	async link(identity: UserIdentity): Promise<void> {
		await this.engine.run(
			`INSERT INTO user_identities(identity_id, user_id, issuer, subject, email, linked_at)
			 VALUES(?, ?, ?, ?, ?, ?)`,
			[
				identity.identityId,
				identity.userId,
				identity.issuer,
				identity.subject,
				identity.email ?? null,
				identity.linkedAt,
			],
		);
	}
}
