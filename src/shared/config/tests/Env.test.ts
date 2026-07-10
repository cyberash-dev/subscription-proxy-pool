/*
 * Config surface: defaults, numeric/string overrides, and OIDC provider
 * discovery from SPP_OIDC_<NAME>_* env vars.
 */

import { loadConfig } from "../Env.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

function runTest(name: string, fn: () => void): void {
	try {
		fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): void {
	if (!cond) {
		throw new Error(label);
	}
}

function clearSppEnv(): void {
	for (const key of Object.keys(process.env)) {
		if (key.startsWith("SPP_")) {
			delete process.env[key];
		}
	}
}

function testDefaults(): void {
	clearSppEnv();
	const config = loadConfig();
	assert(config.proxyPort === 8788, "default proxy port");
	assert(config.mgmtPort === 8789, "default mgmt port");
	assert(config.probeEnabled === false, "probe disabled by default");
	assert(
		config.anthropicBaseUrl === "https://api.anthropic.com",
		"default upstream base",
	);
	assert(
		config.openaiBridgeBaseUrl === "http://127.0.0.1:8080",
		"default openai bridge base",
	);
	assert(config.oidcProviders.size === 0, "no OIDC providers by default");
	assert(config.dbPath.endsWith("pool.db"), "db path under home");
}

function testOverridesAndOidcDiscovery(): void {
	clearSppEnv();
	process.env.SPP_PROXY_PORT = "9000";
	process.env.SPP_PROBE_ENABLED = "true";
	process.env.SPP_OIDC_GOOGLE_ISSUER = "https://accounts.google.com";
	process.env.SPP_OIDC_GOOGLE_CLIENT_ID = "google-client";
	try {
		const config = loadConfig();
		assert(config.proxyPort === 9000, "proxy port overridden");
		assert(config.probeEnabled === true, "probe enabled");
		const google = config.oidcProviders.get("google");
		assert(google !== undefined, "google provider discovered");
		assert(google?.issuer === "https://accounts.google.com", "issuer from env");
		assert(google?.clientId === "google-client", "client id from env");
	} finally {
		clearSppEnv();
	}
}

function testNonNumericPortFallsBack(): void {
	clearSppEnv();
	process.env.SPP_PROXY_PORT = "not-a-number";
	try {
		assert(
			loadConfig().proxyPort === 8788,
			"non-numeric port falls back to default",
		);
	} finally {
		clearSppEnv();
	}
}

function loadErrorFor(tokenCryptKeys: string): string {
	clearSppEnv();
	process.env.SPP_TOKEN_CRYPT_KEYS = tokenCryptKeys;
	try {
		loadConfig();
		return "";
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	} finally {
		clearSppEnv();
	}
}

function testTokenCryptKeysParsed(): void {
	clearSppEnv();
	process.env.SPP_TOKEN_CRYPT_KEYS = `1:${Buffer.alloc(32, 7).toString("base64")}`;
	try {
		const ring = loadConfig().tokenCryptKeys;
		assert(ring.size === 1, "one key parsed");
		assert(ring.get(1)?.length === 32, "key decoded to 32 bytes");
	} finally {
		clearSppEnv();
	}
}

function testTokenCryptKeysMalformedThrows(): void {
	assert(loadErrorFor("nocolon").length > 0, "missing colon rejected");
	assert(loadErrorFor("0:AAAA").length > 0, "key id below 1 rejected");
}

function testMalformedErrorOmitsKeyMaterial(): void {
	const secret = Buffer.alloc(32, 9).toString("base64");

	const message = loadErrorFor(`bad:${secret}`);

	assert(message.length > 0, "non-integer key id rejected");
	assert(!message.includes(secret), "parse error omits the key material");
}

function main(): void {
	runTest("defaults", testDefaults);
	runTest("overrides_and_oidc_discovery", testOverridesAndOidcDiscovery);
	runTest("non_numeric_port_falls_back", testNonNumericPortFallsBack);
	runTest("token_crypt_keys_parsed", testTokenCryptKeysParsed);
	runTest(
		"token_crypt_keys_malformed_throws",
		testTokenCryptKeysMalformedThrows,
	);
	runTest(
		"malformed_error_omits_key_material",
		testMalformedErrorOmitsKeyMaterial,
	);

	const report = { suite: "Env", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((r) => !r.ok)) {
		process.exit(1);
	}
}

main();
