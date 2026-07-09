/* SQLite adapter for subscriptions (spp-subscriptions). */

import type { Engine, SqlParam } from "../../../../shared/db/Engine.ts";
import type { SecretCrypter } from "../../../../shared/crypto/SecretCrypter.ts";
import type { PoolKind } from "../../../../shared/domain/Pool.ts";
import type { ProviderId } from "../../../../shared/domain/Provider.ts";
import type {
	Subscription,
	SubscriptionStatus,
	TokenUpdate,
} from "../../domain/Subscription.ts";
import type {
	SubscriptionFilter,
	SubscriptionRepository,
} from "../../ports/outbound/SubscriptionRepository.ts";

/* eslint-disable-next-line max-properties-per-class/max-properties -- one field per DB column; reshaping the row is a schema/spec change, not a lint refactor */
interface Row {
	readonly subscription_id: string;
	readonly provider: ProviderId;
	readonly pool_kind: PoolKind;
	readonly owner_user_id: string | null;
	readonly label: string | null;
	readonly status: SubscriptionStatus;
	readonly access_token: string;
	readonly refresh_token: string;
	readonly token_expires_at: string;
	readonly scopes: string;
	readonly unusable_reason: string | null;
	readonly created_at: string;
	readonly updated_at: string;
}

export class SqliteSubscriptionRepository implements SubscriptionRepository {
	constructor(
		private readonly engine: Engine,
		private readonly crypter: SecretCrypter,
	) {}

	private toSubscription(row: Row): Subscription {
		return {
			subscriptionId: row.subscription_id,
			provider: row.provider,
			poolKind: row.pool_kind,
			ownerUserId: row.owner_user_id ?? undefined,
			label: row.label ?? undefined,
			status: row.status,
			accessToken: this.crypter.decrypt(row.access_token),
			refreshToken: this.crypter.decrypt(row.refresh_token),
			tokenExpiresAt: row.token_expires_at,
			scopes: row.scopes,
			unusableReason: row.unusable_reason ?? undefined,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	async insert(subscription: Subscription): Promise<void> {
		await this.engine.run(
			`INSERT INTO subscriptions(subscription_id, provider, pool_kind, owner_user_id, label,
			   status, access_token, refresh_token, token_expires_at, scopes, unusable_reason,
			   created_at, updated_at)
			 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
			[
				subscription.subscriptionId,
				subscription.provider,
				subscription.poolKind,
				subscription.ownerUserId ?? null,
				subscription.label ?? null,
				subscription.status,
				this.crypter.encrypt(subscription.accessToken),
				this.crypter.encrypt(subscription.refreshToken),
				subscription.tokenExpiresAt,
				subscription.scopes,
				subscription.createdAt,
				subscription.updatedAt,
			],
		);
	}

	async findById(subscriptionId: string): Promise<Subscription | undefined> {
		const row = await this.engine.get<Row>(
			"SELECT * FROM subscriptions WHERE subscription_id = ?",
			[subscriptionId],
		);
		return row === undefined ? undefined : this.toSubscription(row);
	}

	async updateTokens(
		subscriptionId: string,
		tokens: TokenUpdate,
		updatedAt: string,
	): Promise<void> {
		await this.engine.run(
			`UPDATE subscriptions
			   SET access_token = ?, refresh_token = ?, token_expires_at = ?, scopes = ?, updated_at = ?
			 WHERE subscription_id = ?`,
			[
				this.crypter.encrypt(tokens.accessToken),
				this.crypter.encrypt(tokens.refreshToken),
				tokens.expiresAt,
				tokens.scopes,
				updatedAt,
				subscriptionId,
			],
		);
	}

	async markUnusable(
		subscriptionId: string,
		reason: string,
		updatedAt: string,
	): Promise<void> {
		await this.engine.run(
			"UPDATE subscriptions SET status = 'unusable', unusable_reason = ?, updated_at = ? WHERE subscription_id = ?",
			[reason, updatedAt, subscriptionId],
		);
	}

	async setStatus(
		subscriptionId: string,
		status: SubscriptionStatus,
		updatedAt: string,
	): Promise<void> {
		await this.engine.run(
			"UPDATE subscriptions SET status = ?, updated_at = ? WHERE subscription_id = ?",
			[status, updatedAt, subscriptionId],
		);
	}

	async listByPool(
		poolKind: PoolKind,
		ownerUserId: string | null,
		provider: ProviderId,
	): Promise<Subscription[]> {
		const rows =
			poolKind === "user"
				? await this.engine.all<Row>(
						`SELECT * FROM subscriptions
						 WHERE pool_kind = 'user' AND owner_user_id = ? AND provider = ? AND status = 'active'`,
						[ownerUserId, provider],
					)
				: await this.engine.all<Row>(
						`SELECT * FROM subscriptions
						 WHERE pool_kind = 'donor' AND provider = ? AND status = 'active'`,
						[provider],
					);
		return rows.map((row) => this.toSubscription(row));
	}

	async listActive(provider: ProviderId): Promise<Subscription[]> {
		const rows = await this.engine.all<Row>(
			"SELECT * FROM subscriptions WHERE provider = ? AND status = 'active'",
			[provider],
		);
		return rows.map((row) => this.toSubscription(row));
	}

	async list(filter: SubscriptionFilter): Promise<Subscription[]> {
		const conditions: string[] = [];
		const params: SqlParam[] = [];
		if (filter.poolKind !== undefined) {
			conditions.push("pool_kind = ?");
			params.push(filter.poolKind);
		}
		if (filter.ownerUserId !== undefined) {
			conditions.push("owner_user_id = ?");
			params.push(filter.ownerUserId);
		}
		if (filter.provider !== undefined) {
			conditions.push("provider = ?");
			params.push(filter.provider);
		}
		const where =
			conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const rows = await this.engine.all<Row>(
			`SELECT * FROM subscriptions ${where} ORDER BY created_at`,
			params,
		);
		return rows.map((row) => this.toSubscription(row));
	}
}
