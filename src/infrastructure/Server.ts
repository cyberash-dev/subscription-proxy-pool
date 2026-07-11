/*
 * Composition root. Opens the engine, wires every slice's ports to adapters,
 * builds the identity + subscription provider registries, and starts the two
 * HTTP surfaces (inference proxy + management) plus the optional load prober.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import type { Server as HttpServer } from "node:http";

import type { AppConfig } from "../shared/config/Env.ts";
import { openEngine } from "../shared/db/Connection.ts";
import type { Engine } from "../shared/db/Engine.ts";
import { systemClock, type Clock } from "../shared/domain/Clock.ts";
import { StderrJsonLogger } from "../shared/observability/StderrJsonLogger.ts";
import { systemFetch } from "../shared/http/Fetch.ts";
import { installEgressProxy } from "../shared/net/EgressProxy.ts";
import { SecretCrypter } from "../shared/crypto/SecretCrypter.ts";
import type { ProviderId } from "../shared/domain/Provider.ts";
import { SqlitePkceSessionRepository } from "../shared/pkce/SqlitePkceSessionRepository.ts";

import { AuthService } from "../features/auth/application/AuthService.ts";
import { GenericOidcIdentityProvider } from "../features/auth/adapters/outbound/GenericOidcIdentityProvider.ts";
import {
	SqliteUserIdentityRepository,
	SqliteUserRepository,
} from "../features/auth/adapters/outbound/SqliteUserRepository.ts";
import { SqliteSessionRepository } from "../features/auth/adapters/outbound/SqliteSessionRepository.ts";
import type { IdentityProvider } from "../features/auth/ports/outbound/IdentityProvider.ts";

import { AccessKeysService } from "../features/access-keys/application/AccessKeysService.ts";
import { SqliteProxyKeyRepository } from "../features/access-keys/adapters/outbound/SqliteProxyKeyRepository.ts";

import { SubscriptionOAuthService } from "../features/subscription-oauth/application/SubscriptionOAuthService.ts";
import { TokenManager } from "../features/subscription-oauth/application/TokenManager.ts";
import { AnthropicOAuthProvider } from "../features/subscription-oauth/adapters/outbound/AnthropicOAuthProvider.ts";
import { OpenAiOAuthProvider } from "../features/subscription-oauth/adapters/outbound/OpenAiOAuthProvider.ts";
import type { SubscriptionOAuthProvider } from "../features/subscription-oauth/ports/outbound/SubscriptionOAuthProvider.ts";

import { SubscriptionsService } from "../features/subscriptions/application/SubscriptionsService.ts";
import { SqliteSubscriptionRepository } from "../features/subscriptions/adapters/outbound/SqliteSubscriptionRepository.ts";

import { LoadMonitorService } from "../features/load-monitor/application/LoadMonitorService.ts";
import { SqliteLoadRepository } from "../features/load-monitor/adapters/outbound/SqliteLoadRepository.ts";
import { AnthropicUpstreamProbe } from "../features/load-monitor/adapters/outbound/AnthropicUpstreamProbe.ts";
import { LoadProbeWorker } from "../features/load-monitor/adapters/inbound/LoadProbeWorker.ts";

import { InFlightTracker } from "../features/pool-selection/domain/InFlightTracker.ts";
import { SelectSubscriptionUseCase } from "../features/pool-selection/application/SelectSubscriptionUseCase.ts";

import { HandleMessagesUseCase } from "../features/proxy/application/HandleMessagesUseCase.ts";
import { ProxyHttpServer } from "../features/proxy/adapters/inbound/ProxyHttpServer.ts";
import { FetchUpstreamGateway } from "../features/proxy/adapters/outbound/FetchUpstreamGateway.ts";

import { ManagementHttpServer } from "./ManagementHttpServer.ts";
import {
	loadSppConfigModule,
	resolveEngineConfig,
} from "./ConfigModuleLoader.ts";
import type { SppConfigModule } from "./SppConfigModule.ts";

export interface WiredApp {
	readonly auth: AuthService;
	readonly accessKeys: AccessKeysService;
	readonly subscriptions: SubscriptionsService;
	readonly engine: Engine;
}

export class Server {
	private engine: Engine | undefined;
	private proxyServer: HttpServer | undefined;
	private mgmtServer: HttpServer | undefined;
	private prober: LoadProbeWorker | undefined;

	constructor(private readonly config: AppConfig) {}

	async wire(): Promise<WiredApp> {
		const configModule = await loadSppConfigModule(
			this.config.configModulePath,
		);
		const engine = await this.openEngineChecked(configModule);
		const clock = systemClock;
		const extraProviders =
			configModule?.identityProviders?.({ clock, fetch: systemFetch }) ?? {};

		const pkce = new SqlitePkceSessionRepository(engine);
		const tokenCrypter = new SecretCrypter(this.config.tokenCryptKeys);
		const subscriptionsRepo = new SqliteSubscriptionRepository(
			engine,
			tokenCrypter,
		);
		const loadsRepo = new SqliteLoadRepository(engine);

		const subscriptionProviders = this.buildSubscriptionProviders(clock);

		const auth = new AuthService({
			providers: this.buildIdentityProviders(clock, extraProviders),
			pkce,
			users: new SqliteUserRepository(engine),
			identities: new SqliteUserIdentityRepository(engine),
			sessions: new SqliteSessionRepository(engine),
			clock,
			redirectUri: `${this.config.publicUrl}/auth/callback`,
			sessionTtlMs: this.config.sessionTtlMs,
		});
		const accessKeys = new AccessKeysService(
			new SqliteProxyKeyRepository(engine),
			clock,
		);
		const subscriptionOauth = new SubscriptionOAuthService(
			subscriptionProviders,
			pkce,
			clock,
		);
		const subscriptions = new SubscriptionsService(subscriptionsRepo, clock);
		const tokens = new TokenManager(
			subscriptionsRepo,
			subscriptionProviders,
			clock,
		);
		const inFlight = new InFlightTracker();
		const selector = new SelectSubscriptionUseCase(
			subscriptionsRepo,
			loadsRepo,
			inFlight,
			clock,
		);
		const loadMonitor = this.buildLoadMonitor(
			subscriptionsRepo,
			loadsRepo,
			tokens,
			clock,
		);

		const proxyUseCase = new HandleMessagesUseCase({
			accessKeys,
			selector,
			tokens,
			upstream: new FetchUpstreamGateway(),
			loadMonitor,
			inFlight,
			clock,
			anthropicBaseUrl: this.config.anthropicBaseUrl,
			openaiBridgeBaseUrl: this.config.openaiBridgeBaseUrl,
		});

		this.proxyServer = new ProxyHttpServer(proxyUseCase).createServer();
		this.mgmtServer = new ManagementHttpServer({
			auth,
			accessKeys,
			subscriptionOauth,
			subscriptions,
			loads: loadsRepo,
		}).createServer();

		if (this.config.probeEnabled) {
			this.prober = new LoadProbeWorker(loadMonitor, this.config.probePeriodMs);
		}

		return { auth, accessKeys, subscriptions, engine };
	}

	private async openEngineChecked(
		configModule: SppConfigModule | undefined,
	): Promise<Engine> {
		mkdirSync(this.config.home, { recursive: true, mode: 0o700 });
		const engineConfig = resolveEngineConfig(configModule, this.config.dbPath);
		const engine = await openEngine(engineConfig);
		if (engineConfig.engine === "sqlite" && existsSync(engineConfig.path)) {
			chmodSync(engineConfig.path, this.config.dbFileMode);
		}
		this.engine = engine;
		return engine;
	}

	private buildIdentityProviders(
		clock: Clock,
		extra: Record<string, IdentityProvider>,
	): Map<string, IdentityProvider> {
		const providers = new Map<string, IdentityProvider>();
		for (const [name, providerConfig] of this.config.oidcProviders) {
			providers.set(
				name,
				new GenericOidcIdentityProvider(providerConfig, clock),
			);
		}
		for (const [name, provider] of Object.entries(extra)) {
			providers.set(name, provider);
		}
		return providers;
	}

	private buildSubscriptionProviders(
		clock: Clock,
	): Map<ProviderId, SubscriptionOAuthProvider> {
		const logger = new StderrJsonLogger(clock);
		return new Map<ProviderId, SubscriptionOAuthProvider>([
			[
				"anthropic",
				new AnthropicOAuthProvider({
					clock,
					apiBase: this.config.anthropicBaseUrl,
				}),
			],
			["openai", new OpenAiOAuthProvider({ logger })],
		]);
	}

	private buildLoadMonitor(
		subscriptionsRepo: SqliteSubscriptionRepository,
		loadsRepo: SqliteLoadRepository,
		tokens: TokenManager,
		clock: Clock,
	): LoadMonitorService {
		return new LoadMonitorService({
			loads: loadsRepo,
			probe: new AnthropicUpstreamProbe({
				clock,
				apiBase: this.config.anthropicBaseUrl,
			}),
			clock,
			idleThresholdMs: this.config.idleThresholdMs,
			listActiveSubscriptionIds: async (provider) =>
				(await subscriptionsRepo.listActive(provider)).map(
					(subscription) => subscription.subscriptionId,
				),
			ensureFreshToken: async (subscriptionId) => {
				const sub = await subscriptionsRepo.findById(subscriptionId);
				if (sub === undefined) {
					throw new Error(`subscription_not_found:${subscriptionId}`);
				}
				return tokens.ensureFresh(sub);
			},
		});
	}

	async start(): Promise<void> {
		installEgressProxy(this.config.egressProxyUrl, this.config.noProxy);
		if (this.proxyServer === undefined || this.mgmtServer === undefined) {
			await this.wire();
		}
		await listen(
			this.proxyServer,
			this.config.listenAddr,
			this.config.proxyPort,
		);
		await listen(this.mgmtServer, this.config.listenAddr, this.config.mgmtPort);
		this.prober?.start();
		process.stdout.write(
			`proxy: http://${this.config.listenAddr}:${this.config.proxyPort}\n` +
				`management: http://${this.config.listenAddr}:${this.config.mgmtPort}\n`,
		);
	}

	async stop(): Promise<void> {
		this.prober?.stop();
		await closeServer(this.proxyServer);
		await closeServer(this.mgmtServer);
		await this.engine?.close();
	}
}

function listen(
	server: HttpServer | undefined,
	host: string,
	port: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (server === undefined) {
			reject(new Error("server not wired"));
			return;
		}
		server.once("error", reject);
		server.listen(port, host, () => {
			resolve();
		});
	});
}

function closeServer(server: HttpServer | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (server === undefined) {
			resolve();
			return;
		}
		server.close(() => {
			resolve();
		});
	});
}
