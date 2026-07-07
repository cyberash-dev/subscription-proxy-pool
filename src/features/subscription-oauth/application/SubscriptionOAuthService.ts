/*
 * Level-2 subscription linking (spp-subscription-oauth): PKCE begin/complete.
 * Provider specifics live behind SubscriptionOAuthProvider; the registry selects
 * by provider id with no caller change (pol:POL-PROVIDER-001).
 */

import type { Clock } from "../../../shared/domain/Clock.ts";
import {
	type ProviderId,
	isProviderId,
} from "../../../shared/domain/Provider.ts";
import { badRequest, HttpError } from "../../../shared/http/Errors.ts";
import { generatePkce, randomToken } from "../../../shared/pkce/Pkce.ts";
import type { PkceSessionRepository } from "../../../shared/pkce/PkceSession.ts";
import type {
	CredentialVerdict,
	SubscriptionOAuthProvider,
} from "../ports/outbound/SubscriptionOAuthProvider.ts";
import type {
	BeginLinkInput,
	BeginLinkResult,
	CompleteLinkInput,
	LinkedSubscriptionGrant,
	SubscriptionOAuthPort,
} from "../ports/inbound/SubscriptionOAuthPort.ts";

export class SubscriptionOAuthService implements SubscriptionOAuthPort {
	constructor(
		private readonly providers: ReadonlyMap<
			ProviderId,
			SubscriptionOAuthProvider
		>,
		private readonly pkce: PkceSessionRepository,
		private readonly clock: Clock,
		private readonly verifyAttempts: number = 3,
	) {}

	async beginLink(input: BeginLinkInput): Promise<BeginLinkResult> {
		const provider = this.providers.get(input.provider);
		if (provider === undefined) {
			throw badRequest(`unsupported provider: ${input.provider}`);
		}
		if (input.poolKind === "user" && input.ownerUserId === undefined) {
			throw badRequest("user-pool subscription requires an owner");
		}
		const challenge = generatePkce();
		const state = randomToken();
		await this.pkce.create({
			sessionId: state,
			kind: "subscription",
			provider: input.provider,
			verifier: challenge.verifier,
			poolKind: input.poolKind,
			ownerUserId: input.ownerUserId,
			createdAt: this.clock.nowIso(),
		});
		const authorizeUrl = await provider.buildAuthorizeUrl({ state, challenge });
		return { authorizeUrl, state };
	}

	async completeLink(
		input: CompleteLinkInput,
	): Promise<LinkedSubscriptionGrant> {
		const record = await this.pkce.consume(input.state, this.clock.nowIso());
		if (record === undefined || record.kind !== "subscription") {
			throw badRequest("invalid or already-used link state");
		}
		if (!isProviderId(record.provider) || record.poolKind === undefined) {
			throw badRequest("corrupt link session");
		}
		const provider = this.providers.get(record.provider);
		if (provider === undefined) {
			throw badRequest(`unsupported provider: ${record.provider}`);
		}
		const grant = await provider.exchangeCode({
			code: input.code,
			verifier: record.verifier,
		});
		const verdict = await this.verifyGrant(provider, grant.accessToken);
		if (verdict === "invalid") {
			throw badRequest("subscription_credentials_invalid");
		}
		if (verdict !== "valid") {
			throw new HttpError(
				503,
				"overloaded_error",
				"subscription_verification_unavailable",
			);
		}
		return {
			provider: record.provider,
			poolKind: record.poolKind,
			ownerUserId: record.ownerUserId,
			grant,
		};
	}

	private async verifyGrant(
		provider: SubscriptionOAuthProvider,
		accessToken: string,
	): Promise<CredentialVerdict> {
		let verdict: CredentialVerdict = "inconclusive";
		for (let attempt = 0; attempt < this.verifyAttempts; attempt += 1) {
			verdict = await provider.verifyCredentials(accessToken);
			if (verdict !== "inconclusive") {
				return verdict;
			}
		}
		return verdict;
	}
}
