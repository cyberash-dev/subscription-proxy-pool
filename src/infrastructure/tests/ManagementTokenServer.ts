import { createServer } from "node:http";

import { openAiAccessToken } from "../../features/subscription-oauth/tests/openAiAccessToken.ts";

export interface TokenServer {
	readonly url: string;
	readonly baseUrl: string;
	close(): Promise<void>;
}

export async function startTokenServer(
	verifyStatus = 200,
): Promise<TokenServer> {
	let tokenNumber = 0;
	const server = createServer((request, response) => {
		if ((request.url ?? "").startsWith("/v1/messages")) {
			response.writeHead(verifyStatus, { "content-type": "application/json" });
			response.end("{}");
			return;
		}
		if ((request.url ?? "").startsWith("/openai/accounts")) {
			const isAuthorized =
				request.headers.authorization?.startsWith("Bearer ") === true &&
				request.headers["chatgpt-account-id"] === "account-1";
			response.writeHead(isAuthorized ? 200 : 401, {
				"content-type": "application/json",
			});
			response.end("{}");
			return;
		}
		tokenNumber += 1;
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({
				access_token: openAiAccessToken(),
				refresh_token: `rt-${tokenNumber}`,
				expires_in: 3600,
			}),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (address === null || typeof address === "string") {
		throw new Error("token_server_address_unavailable");
	}
	return {
		url: `http://127.0.0.1:${address.port}/token`,
		baseUrl: `http://127.0.0.1:${address.port}`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
