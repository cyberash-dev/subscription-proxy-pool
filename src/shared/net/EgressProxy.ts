/*
 * Outbound egress through an HTTP CONNECT forward-proxy (spp-proxy:BEH-005):
 * internal deployments have no direct external route, so the global fetch
 * dispatcher is pointed at the configured proxy. CONNECT keeps TLS end-to-end,
 * so a subscription Bearer reaches Anthropic unchanged; NO_PROXY hosts bypass.
 */

import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

/*
 * Install the egress forward-proxy when `proxyUrl` is set. Returns whether a
 * proxy dispatcher was installed; with no URL the global dispatcher is left
 * untouched (direct egress).
 */
export function installEgressProxy(
	proxyUrl: string | undefined,
	noProxy: string | undefined,
): boolean {
	if (proxyUrl === undefined || proxyUrl.length === 0) {
		return false;
	}
	setGlobalDispatcher(
		new EnvHttpProxyAgent({
			httpProxy: proxyUrl,
			httpsProxy: proxyUrl,
			noProxy: noProxy ?? "",
		}),
	);
	return true;
}
