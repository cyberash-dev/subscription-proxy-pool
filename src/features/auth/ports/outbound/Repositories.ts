/*
 * Driven ports for the auth slice: user accounts, external-identity links, and
 * management sessions. SQLite adapters implement these.
 */

import type { Session, User, UserIdentity } from "../../domain/User.ts";

export interface UserRepository {
	insert(user: User): Promise<void>;
	findById(userId: string): Promise<User | undefined>;
}

export interface UserIdentityRepository {
	findByExternal(
		issuer: string,
		subject: string,
	): Promise<UserIdentity | undefined>;
	link(identity: UserIdentity): Promise<void>;
}

export interface StoredSession extends Session {
	readonly sessionHash: string;
	readonly revokedAt?: string;
}

export interface SessionRepository {
	insert(session: StoredSession): Promise<void>;
	findByHash(sessionHash: string): Promise<StoredSession | undefined>;
	revoke(sessionId: string, revokedAt: string): Promise<void>;
}
