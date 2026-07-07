/* Driving port for level-2 subscription OAuth linking. */

import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type { OAuthGrant, PoolKind } from "../../domain/OAuthGrant.ts";

export interface BeginLinkInput {
	readonly provider: ProviderId;
	readonly poolKind: PoolKind;
	readonly ownerUserId?: string;
}

export interface BeginLinkResult {
	readonly authorizeUrl: string;
	readonly state: string;
}

export interface CompleteLinkInput {
	readonly state: string;
	readonly code: string;
}

/* The verified grant plus the pool context captured at begin-link. The caller
 * (management adapter) hands this to the subscriptions slice to persist. */
export interface LinkedSubscriptionGrant {
	readonly provider: ProviderId;
	readonly poolKind: PoolKind;
	readonly ownerUserId?: string;
	readonly grant: OAuthGrant;
}

export interface SubscriptionOAuthPort {
	beginLink(input: BeginLinkInput): Promise<BeginLinkResult>;
	completeLink(input: CompleteLinkInput): Promise<LinkedSubscriptionGrant>;
}
