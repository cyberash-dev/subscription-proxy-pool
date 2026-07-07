/*
 * Driving port for level-1 authentication. The management HTTP adapter calls
 * these; the AuthService implements them.
 */

import type { SessionPrincipal } from "../../domain/User.ts";

export interface BeginLoginInput {
	readonly provider: string;
	readonly redirectAfter?: string;
}

export interface BeginLoginResult {
	readonly authorizeUrl: string;
	readonly state: string;
}

export interface CompleteLoginInput {
	readonly state: string;
	readonly code: string;
}

export interface CompleteLoginResult {
	readonly sessionToken: string;
	readonly userId: string;
	readonly expiresAt: string;
	readonly redirectAfter?: string;
}

export interface AuthPort {
	beginLogin(input: BeginLoginInput): Promise<BeginLoginResult>;
	completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult>;
	resolveSession(sessionToken: string): Promise<SessionPrincipal | undefined>;
	logout(sessionToken: string): Promise<void>;
}
