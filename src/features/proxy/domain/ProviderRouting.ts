/*
 * Model-based provider routing (spp-proxy:BEH-006/BEH-007, INV-003): pick the
 * subscription provider from the request model and build the exact OpenAI-bridge
 * header set. OpenAI wire specifics stay quarantined in shared/openai.
 */

import type { ProviderId } from "../../../shared/domain/Provider.ts";
import {
	CHATGPT_ACCOUNT_ID_HEADER,
	isOpenAiModel,
} from "../../../shared/openai/Constants.ts";

export function providerForModel(model: string): ProviderId {
	return isOpenAiModel(model) ? "openai" : "anthropic";
}

/* Built from scratch so no caller proxy key, x-api-key, anthropic-version,
   anthropic-beta, or inbound header can reach the bridge (spp-proxy:CNT-002). */
export function buildBridgeHeaders(
	accessToken: string,
	accountId: string,
	wantStream: boolean,
): Record<string, string> {
	return {
		authorization: `Bearer ${accessToken}`,
		[CHATGPT_ACCOUNT_ID_HEADER]: accountId,
		"content-type": "application/json",
		accept: wantStream ? "text/event-stream" : "application/json",
	};
}
