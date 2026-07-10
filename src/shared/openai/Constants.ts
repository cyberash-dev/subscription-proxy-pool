/*
 * OpenAI/ChatGPT subscription protocol constants, quarantined here so the rest
 * of the codebase stays provider-agnostic (pol:POL-PROVIDER-001). Model-family
 * routing and the ChatGPT account-id claim live at this one boundary.
 */

/* Header the ChatGPT backend and the OpenAI bridge expect alongside the
   subscription Bearer to scope a call to one account. */
export const CHATGPT_ACCOUNT_ID_HEADER = "chatgpt-account-id";

/* A model routes to the OpenAI pool when its identifier begins with gpt- or
   codex-, or matches o<digits> followed by end-of-string or - (spp-proxy
   glossary: OpenAI model family). Every other value stays on Anthropic. */
export function isOpenAiModel(model: string): boolean {
	return /^(?:gpt-|codex-|o\d+(?:-|$))/.test(model);
}

/* Read the chatgpt_account_id claim from an OpenAI access token (a JWT).
   Returns undefined for a malformed token or an absent/empty claim. */
export function chatGptAccountId(accessToken: string): string | undefined {
	const encodedPayload = /^[^.]+\.([^.]+)\.[^.]+$/.exec(accessToken)?.[1];
	if (encodedPayload === undefined) {
		return undefined;
	}
	let payload: unknown;
	try {
		payload = JSON.parse(
			Buffer.from(encodedPayload, "base64url").toString("utf8"),
		) as unknown;
	} catch {
		return undefined;
	}
	if (!isJsonObject(payload)) {
		return undefined;
	}
	const authClaims = payload["https://api.openai.com/auth"];
	if (!isJsonObject(authClaims)) {
		return undefined;
	}
	const accountId = authClaims.chatgpt_account_id;
	return typeof accountId === "string" && accountId.length > 0
		? accountId
		: undefined;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
