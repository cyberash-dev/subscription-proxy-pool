/*
 * Management + auth HTTP surface (spp-mgmt-http). Routes /auth/* to auth and
 * /api/* (behind a session) to access-keys, subscription-oauth, subscriptions
 * and pool status. Session bearer and proxy key are distinct (pol:POL-AUTH-001).
 */

import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

import { badRequest, unauthorized } from "../shared/http/Errors.ts";
import {
	bearerFrom,
	readJson,
	sendError,
	sendJson,
} from "../shared/http/HttpUtil.ts";
import { type ProviderId, isProviderId } from "../shared/domain/Provider.ts";
import type { PoolKind, PoolTarget } from "../shared/domain/Pool.ts";
import type { SessionPrincipal } from "../features/auth/domain/User.ts";
import type { AuthPort } from "../features/auth/ports/inbound/AuthPort.ts";
import type { AccessKeysPort } from "../features/access-keys/ports/inbound/AccessKeysPort.ts";
import type { SubscriptionOAuthPort } from "../features/subscription-oauth/ports/inbound/SubscriptionOAuthPort.ts";
import type { SubscriptionsPort } from "../features/subscriptions/ports/inbound/SubscriptionsPort.ts";
import type { LoadRepository } from "../features/load-monitor/ports/outbound/LoadRepository.ts";

export interface ManagementDeps {
	readonly auth: AuthPort;
	readonly accessKeys: AccessKeysPort;
	readonly subscriptionOauth: SubscriptionOAuthPort;
	readonly subscriptions: SubscriptionsPort;
	readonly loads: LoadRepository;
}

function asPoolTarget(value: unknown): PoolTarget {
	if (value === "own" || value === "donor") {
		return value;
	}
	throw badRequest("pool_target must be 'own' or 'donor'");
}

function asPoolKind(value: unknown): PoolKind {
	if (value === "user" || value === "donor") {
		return value;
	}
	throw badRequest("pool_kind must be 'user' or 'donor'");
}

function asProvider(value: unknown): ProviderId {
	if (typeof value === "string" && isProviderId(value)) {
		return value;
	}
	throw badRequest("unknown provider");
}

export class ManagementHttpServer {
	constructor(private readonly deps: ManagementDeps) {}

	createServer(): Server {
		return createServer((req, response) => {
			void this.route(req, response);
		});
	}

	private async route(
		req: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(req.url ?? "/", "http://localhost");
			const method = req.method ?? "GET";
			const path = url.pathname;

			if (method === "GET" && path === "/health") {
				sendJson(response, 200, { status: "ok" });
				return;
			}
			if (method === "GET" && path.startsWith("/auth/login/")) {
				await this.beginLogin(response, path.slice("/auth/login/".length));
				return;
			}
			if (method === "GET" && path === "/auth/callback") {
				await this.completeLogin(response, url);
				return;
			}
			if (path.startsWith("/api/")) {
				await this.api(req, response, method, path);
				return;
			}
			throw badRequest(`no route for ${method} ${path}`);
		} catch (err) {
			sendError(response, err);
		}
	}

	private async beginLogin(
		response: ServerResponse,
		provider: string,
	): Promise<void> {
		const result = await this.deps.auth.beginLogin({ provider });
		response.writeHead(302, { location: result.authorizeUrl });
		response.end();
	}

	private async completeLogin(
		response: ServerResponse,
		url: URL,
	): Promise<void> {
		const state = url.searchParams.get("state");
		const code = url.searchParams.get("code");
		if (state === null || code === null) {
			throw badRequest("callback requires state and code");
		}
		const result = await this.deps.auth.completeLogin({ state, code });
		sendJson(response, 200, {
			session_token: result.sessionToken,
			user_id: result.userId,
			expires_at: result.expiresAt,
		});
	}

	private async api(
		req: IncomingMessage,
		response: ServerResponse,
		method: string,
		path: string,
	): Promise<void> {
		const principal = await this.requireSession(req);

		if (path === "/api/keys" && method === "POST") {
			const body = await readJson<{ pool_target?: unknown }>(req);
			const issued = await this.deps.accessKeys.issueKey(
				principal.userId,
				asPoolTarget(body.pool_target),
			);
			sendJson(response, 201, {
				key_id: issued.keyId,
				secret: issued.secret,
				pool_target: issued.poolTarget,
			});
			return;
		}
		if (path === "/api/keys" && method === "GET") {
			sendJson(response, 200, {
				keys: await this.deps.accessKeys.listKeys(principal.userId),
			});
			return;
		}
		if (path.startsWith("/api/keys/") && method === "DELETE") {
			await this.deps.accessKeys.revokeKey(
				principal.userId,
				path.slice("/api/keys/".length),
			);
			sendJson(response, 200, { revoked: true });
			return;
		}
		if (path === "/api/subscriptions/login" && method === "POST") {
			await this.beginSubscriptionLink(req, response, principal);
			return;
		}
		if (path === "/api/subscriptions/complete" && method === "POST") {
			await this.completeSubscriptionLink(req, response);
			return;
		}
		if (path === "/api/subscriptions" && method === "GET") {
			sendJson(response, 200, {
				subscriptions: await this.deps.subscriptions.list({
					ownerUserId: principal.userId,
				}),
			});
			return;
		}
		if (path.startsWith("/api/subscriptions/") && method === "PATCH") {
			const id = path.slice("/api/subscriptions/".length);
			await this.deps.subscriptions.disable(principal.userId, id);
			sendJson(response, 200, { disabled: true });
			return;
		}
		if (path === "/api/pools" && method === "GET") {
			await this.poolStatus(response, principal);
			return;
		}
		throw badRequest(`no route for ${method} ${path}`);
	}

	private async beginSubscriptionLink(
		req: IncomingMessage,
		response: ServerResponse,
		principal: SessionPrincipal,
	): Promise<void> {
		const body = await readJson<{ provider?: unknown; pool_kind?: unknown }>(
			req,
		);
		const poolKind = asPoolKind(body.pool_kind);
		const result = await this.deps.subscriptionOauth.beginLink({
			provider: asProvider(body.provider),
			poolKind,
			ownerUserId: poolKind === "user" ? principal.userId : undefined,
		});
		sendJson(response, 200, {
			authorize_url: result.authorizeUrl,
			state: result.state,
		});
	}

	private async completeSubscriptionLink(
		req: IncomingMessage,
		response: ServerResponse,
	): Promise<void> {
		const body = await readJson<{
			state?: unknown;
			code?: unknown;
			label?: unknown;
		}>(req);
		if (typeof body.state !== "string" || typeof body.code !== "string") {
			throw badRequest("state and code are required");
		}
		const linked = await this.deps.subscriptionOauth.completeLink({
			state: body.state,
			code: body.code,
		});
		const added = await this.deps.subscriptions.add({
			provider: linked.provider,
			poolKind: linked.poolKind,
			ownerUserId: linked.ownerUserId,
			label: typeof body.label === "string" ? body.label : undefined,
			accessToken: linked.grant.accessToken,
			refreshToken: linked.grant.refreshToken,
			tokenExpiresAt: linked.grant.expiresAt,
			scopes: linked.grant.scopes,
		});
		sendJson(response, 201, { subscription_id: added.subscriptionId });
	}

	private async poolStatus(
		response: ServerResponse,
		principal: SessionPrincipal,
	): Promise<void> {
		const own = await this.deps.subscriptions.list({
			ownerUserId: principal.userId,
		});
		const donor = await this.deps.subscriptions.list({ poolKind: "donor" });
		const withLoad = async (
			list: Awaited<ReturnType<SubscriptionsPort["list"]>>,
		): Promise<unknown[]> =>
			Promise.all(
				list.map(async (summary) => {
					const load = await this.deps.loads.latestBySubscription(
						summary.subscriptionId,
					);
					return {
						subscription_id: summary.subscriptionId,
						provider: summary.provider,
						status: summary.status,
						utilization_5h: load?.util5h ?? null,
						utilization_7d: load?.util7d ?? null,
						unified_status: load?.unifiedStatus ?? null,
						cooldown_until: load?.cooldownUntil ?? null,
					};
				}),
			);
		sendJson(response, 200, {
			own: await withLoad(own),
			donor: await withLoad(donor),
		});
	}

	private async requireSession(
		req: IncomingMessage,
	): Promise<SessionPrincipal> {
		const bearer = bearerFrom(req);
		if (bearer === undefined) {
			throw unauthorized("session required");
		}
		const principal = await this.deps.auth.resolveSession(bearer);
		if (principal === undefined) {
			throw unauthorized("invalid or expired session");
		}
		return principal;
	}
}
