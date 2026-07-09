export function openAiAccessToken(
	accountId: string | null = "account-1",
): string {
	const header = Buffer.from(
		JSON.stringify({ alg: "none", typ: "JWT" }),
	).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			"https://api.openai.com/auth":
				accountId === null ? {} : { chatgpt_account_id: accountId },
		}),
	).toString("base64url");
	return `${header}.${payload}.signature`;
}
