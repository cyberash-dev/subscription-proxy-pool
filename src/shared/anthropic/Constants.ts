/*
 * Anthropic/Claude Code protocol constants, quarantined here so the rest of the
 * codebase stays provider-agnostic (pol:POL-PROVIDER-001). All undocumented
 * Claude Code OAuth behaviour (identity system block, beta headers, public
 * client id) lives at this one boundary.
 */

/* Public Claude Code OAuth client id (shared with community tooling). */
export const CLAUDE_CODE_CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

export const ANTHROPIC_OAUTH_SCOPES = [
	"org:create_api_key",
	"user:profile",
	"user:inference",
] as const;

export const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_TOKEN_URL =
	"https://console.anthropic.com/v1/oauth/token";
export const ANTHROPIC_REDIRECT_URI =
	"https://console.anthropic.com/oauth/code/callback";

export const ANTHROPIC_API_BASE = "https://api.anthropic.com";
export const ANTHROPIC_VERSION = "2023-06-01";
export const ANTHROPIC_BETA = "oauth-2025-04-20,claude-code-20250219";

/* Cheapest model for a validity/load probe. Haiku is exempt from the identity
   system-block rule, so a `.`-message max_tokens=1 request suffices. Date-pinned
   to avoid alias drift (`claude-haiku-4-5` is the moving alias). */
export const ANTHROPIC_PROBE_MODEL = "claude-haiku-4-5-20251001";

/*
 * Undocumented: for non-Haiku models the `system` field MUST begin with this
 * exact block or the Messages API returns a generic 400 (anthropics/claude-code
 * issue #40515). Haiku is exempt.
 */
export const CLAUDE_CODE_IDENTITY =
	"You are Claude Code, Anthropic's official CLI for Claude.";

export function isHaikuModel(model: string): boolean {
	return /haiku/i.test(model);
}

/*
 * Hop-by-hop headers that must not be copied between the client and the upstream
 * (RFC 7230 §6.1) plus credential/routing headers we always strip.
 */
export const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host",
	"content-length",
]);
