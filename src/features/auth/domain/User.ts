/*
 * Level-1 identity domain: a person (User), their linked social identities
 * (UserIdentity), a management-API Session, and the ExternalIdentity an
 * IdentityProvider yields at login. No framework or provider specifics here.
 */

export interface User {
	readonly userId: string;
	readonly handle?: string;
	readonly createdAt: string;
}

export interface UserIdentity {
	readonly identityId: string;
	readonly userId: string;
	readonly issuer: string;
	readonly subject: string;
	readonly email?: string;
	readonly linkedAt: string;
}

/* What an IdentityProvider verifies about the person at login. */
export interface ExternalIdentity {
	readonly issuer: string;
	readonly subject: string;
	readonly email?: string;
}

export interface Session {
	readonly sessionId: string;
	readonly userId: string;
	readonly createdAt: string;
	readonly expiresAt: string;
}

/* Resolved principal of a management-API session. */
export interface SessionPrincipal {
	readonly userId: string;
}
