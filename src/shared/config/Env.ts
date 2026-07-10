/*
 * Runtime configuration surface (spp-env@1). All environment reads live here so
 * every slice sees one resolved config object. Secrets are read at spawn time,
 * never baked in.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export interface OidcProviderConfig {
	readonly name: string;
	readonly issuer: string;
	readonly clientId: string;
	readonly clientSecret: string;
	readonly scopes: string;
}

/* eslint-disable-next-line max-properties-per-class/max-properties -- config surface: one field per env var (spp-env); grouping is cosmetic */
export interface AppConfig {
	readonly home: string;
	readonly dbPath: string;
	readonly listenAddr: string;
	readonly proxyPort: number;
	readonly mgmtPort: number;
	readonly publicUrl: string;
	readonly anthropicBaseUrl: string;
	readonly openaiBridgeBaseUrl: string;
	readonly dbFileMode: number;
	readonly sessionTtlMs: number;
	readonly probeEnabled: boolean;
	readonly probePeriodMs: number;
	readonly idleThresholdMs: number;
	readonly oidcProviders: ReadonlyMap<string, OidcProviderConfig>;
	readonly configModulePath: string | undefined;
	readonly egressProxyUrl: string | undefined;
	readonly noProxy: string | undefined;
	readonly tokenCryptKeys: ReadonlyMap<number, Buffer>;
}

function num(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw.trim().length === 0) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function str(name: string, fallback: string): string {
	const raw = process.env[name];
	return raw === undefined || raw.length === 0 ? fallback : raw;
}

function optionalStr(name: string): string | undefined {
	const raw = process.env[name];
	return raw === undefined || raw.length === 0 ? undefined : raw;
}

/*
 * Parse "<id>:<base64-key>[,<id>:<base64-key>]" into a version->key ring for
 * SecretCrypter. Absent/empty yields an empty ring; SecretCrypter enforces
 * non-empty and 32-byte keys at startup. A present-but-malformed entry throws.
 */
function readTokenCryptKeys(name: string): Map<number, Buffer> {
	const raw = process.env[name];
	const keys = new Map<number, Buffer>();
	if (raw === undefined || raw.trim().length === 0) {
		return keys;
	}
	let segmentNumber = 0;
	for (const segment of raw.split(",")) {
		segmentNumber += 1;
		const trimmed = segment.trim();
		if (trimmed.length === 0) {
			continue;
		}
		const sep = trimmed.indexOf(":");
		if (sep <= 0) {
			throw new Error(`invalid_token_crypt_keys:segment_${segmentNumber}`);
		}
		const id = Number(trimmed.slice(0, sep));
		if (!Number.isInteger(id) || id < 1) {
			throw new Error(`invalid_token_crypt_keys:segment_${segmentNumber}`);
		}
		keys.set(id, Buffer.from(trimmed.slice(sep + 1), "base64"));
	}
	return keys;
}

/*
 * Discover OIDC providers from SPP_OIDC_<NAME>_ISSUER (+ _CLIENT_ID,
 * _CLIENT_SECRET, _SCOPES). <NAME> is lowercased into the provider key.
 */
function readOidcProviders(): Map<string, OidcProviderConfig> {
	const providers = new Map<string, OidcProviderConfig>();
	for (const [key, value] of Object.entries(process.env)) {
		const match = /^SPP_OIDC_([A-Z0-9]+)_ISSUER$/.exec(key);
		if (match === undefined || match === null || value === undefined) {
			continue;
		}
		const upper = match[1];
		const name = upper.toLowerCase();
		providers.set(name, {
			name,
			issuer: value,
			clientId: str(`SPP_OIDC_${upper}_CLIENT_ID`, ""),
			clientSecret: str(`SPP_OIDC_${upper}_CLIENT_SECRET`, ""),
			scopes: str(`SPP_OIDC_${upper}_SCOPES`, "openid email profile"),
		});
	}
	return providers;
}

export function loadConfig(): AppConfig {
	const home = str("SPP_HOME", join(homedir(), ".subscription-proxy-pool"));
	return {
		home,
		dbPath: join(home, "pool.db"),
		listenAddr: str("SPP_LISTEN_ADDR", "127.0.0.1"),
		proxyPort: num("SPP_PROXY_PORT", 8788),
		mgmtPort: num("SPP_MGMT_PORT", 8789),
		publicUrl: str("SPP_PUBLIC_URL", "http://127.0.0.1:8789"),
		anthropicBaseUrl: str(
			"SPP_ANTHROPIC_BASE_URL",
			"https://api.anthropic.com",
		),
		openaiBridgeBaseUrl: str(
			"SPP_OPENAI_BRIDGE_BASE_URL",
			"http://127.0.0.1:8080",
		),
		dbFileMode: num("SPP_DB_FILE_MODE", 0o600),
		sessionTtlMs: num("SPP_SESSION_TTL_MS", 7 * 24 * 60 * 60 * 1000),
		probeEnabled: str("SPP_PROBE_ENABLED", "false") === "true",
		probePeriodMs: num("SPP_PROBE_PERIOD_MS", 60_000),
		idleThresholdMs: num("SPP_IDLE_THRESHOLD_MS", 120_000),
		oidcProviders: readOidcProviders(),
		configModulePath: optionalStr("SPP_CONFIG"),
		egressProxyUrl:
			optionalStr("SPP_EGRESS_PROXY") ??
			optionalStr("HTTPS_PROXY") ??
			optionalStr("https_proxy"),
		noProxy: optionalStr("NO_PROXY") ?? optionalStr("no_proxy"),
		tokenCryptKeys: readTokenCryptKeys("SPP_TOKEN_CRYPT_KEYS"),
	};
}
