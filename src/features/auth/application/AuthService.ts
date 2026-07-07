/*
 * Level-1 authentication use cases (spp-auth): OIDC login begin/complete,
 * session resolution and logout. Social tokens never stored (spp-auth:INV-002).
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import {
	hashSecret,
	newOpaqueSecret,
	newUuid,
} from "../../../shared/domain/Scalars.ts";
import { badRequest } from "../../../shared/http/Errors.ts";
import { generatePkce, randomToken } from "../../../shared/pkce/Pkce.ts";
import type { PkceSessionRepository } from "../../../shared/pkce/PkceSession.ts";
import type { SessionPrincipal } from "../domain/User.ts";
import type { IdentityProvider } from "../ports/outbound/IdentityProvider.ts";
import type {
	SessionRepository,
	UserIdentityRepository,
	UserRepository,
} from "../ports/outbound/Repositories.ts";
import type {
	AuthPort,
	BeginLoginInput,
	BeginLoginResult,
	CompleteLoginInput,
	CompleteLoginResult,
} from "../ports/inbound/AuthPort.ts";

export interface AuthServiceDeps {
	readonly providers: ReadonlyMap<string, IdentityProvider>;
	readonly pkce: PkceSessionRepository;
	readonly users: UserRepository;
	readonly identities: UserIdentityRepository;
	readonly sessions: SessionRepository;
	readonly clock: Clock;
	readonly redirectUri: string;
	readonly sessionTtlMs: number;
}

export class AuthService implements AuthPort {
	constructor(private readonly deps: AuthServiceDeps) {}

	async beginLogin(input: BeginLoginInput): Promise<BeginLoginResult> {
		const provider = this.deps.providers.get(input.provider);
		if (provider === undefined) {
			throw badRequest(`unknown identity provider: ${input.provider}`);
		}
		const challenge = generatePkce();
		const state = randomToken();
		const nonce = randomToken();
		await this.deps.pkce.create({
			sessionId: state,
			kind: "login",
			provider: input.provider,
			verifier: challenge.verifier,
			nonce,
			redirectAfter: input.redirectAfter,
			createdAt: this.deps.clock.nowIso(),
		});
		const authorizeUrl = await provider.buildAuthorizeUrl({
			state,
			nonce,
			challenge,
			redirectUri: this.deps.redirectUri,
		});
		return { authorizeUrl, state };
	}

	async completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
		const record = await this.deps.pkce.consume(
			input.state,
			this.deps.clock.nowIso(),
		);
		if (record === undefined || record.kind !== "login") {
			throw badRequest("invalid or already-used login state");
		}
		const provider = this.deps.providers.get(record.provider);
		if (provider === undefined) {
			throw badRequest(`unknown identity provider: ${record.provider}`);
		}
		const external = await provider.exchangeCode({
			code: input.code,
			verifier: record.verifier,
			nonce: record.nonce ?? "",
			redirectUri: this.deps.redirectUri,
		});

		const userId = await this.resolveOrCreateUser(external);
		const sessionToken = newOpaqueSecret("spp_sess");
		const now = this.deps.clock.nowMs();
		const expiresAt = new Date(now + this.deps.sessionTtlMs).toISOString();
		await this.deps.sessions.insert({
			sessionId: newUuid(),
			userId,
			sessionHash: hashSecret(sessionToken),
			createdAt: this.deps.clock.nowIso(),
			expiresAt,
		});
		return {
			sessionToken,
			userId,
			expiresAt,
			redirectAfter: record.redirectAfter,
		};
	}

	async resolveSession(
		sessionToken: string,
	): Promise<SessionPrincipal | undefined> {
		const stored = await this.deps.sessions.findByHash(
			hashSecret(sessionToken),
		);
		if (stored === undefined || stored.revokedAt !== undefined) {
			return undefined;
		}
		if (stored.expiresAt <= this.deps.clock.nowIso()) {
			return undefined;
		}
		return { userId: stored.userId };
	}

	async logout(sessionToken: string): Promise<void> {
		const stored = await this.deps.sessions.findByHash(
			hashSecret(sessionToken),
		);
		if (stored === undefined) {
			return;
		}
		await this.deps.sessions.revoke(stored.sessionId, this.deps.clock.nowIso());
	}

	private async resolveOrCreateUser(external: {
		issuer: string;
		subject: string;
		email?: string;
	}): Promise<string> {
		const existing = await this.deps.identities.findByExternal(
			external.issuer,
			external.subject,
		);
		if (existing !== undefined) {
			return existing.userId;
		}
		const userId = newUuid();
		const now = this.deps.clock.nowIso();
		/* email lives on the user_identity link, not as the unique user handle. */
		await this.deps.users.insert({ userId, createdAt: now });
		await this.deps.identities.link({
			identityId: newUuid(),
			userId,
			issuer: external.issuer,
			subject: external.subject,
			email: external.email,
			linkedAt: now,
		});
		return userId;
	}
}
