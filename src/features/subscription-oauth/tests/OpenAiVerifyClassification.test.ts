/*
 * OpenAI verify edge-case classification: a 401/403 with an HTML edge block page
 * (Cloudflare on the ChatGPT backend) is inconclusive, not invalid; a JSON or
 * body-less 401/403 stays invalid. The verify outcome is logged.
 *
 * @covers spp-subscription-oauth:DLT-006
 */

import type { FetchFn } from "../../../shared/http/Fetch.ts";
import type {
	LogFields,
	Logger,
} from "../../../shared/observability/Logger.ts";
import { OpenAiOAuthProvider } from "../adapters/outbound/OpenAiOAuthProvider.ts";
import { openAiAccessToken } from "./openAiAccessToken.ts";

interface TestRecord {
	name: string;
	ok: boolean;
	error?: string;
}
const results: TestRecord[] = [];

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (err) {
		const message =
			err instanceof Error ? (err.stack ?? err.message) : String(err);
		results.push({ name, ok: false, error: message });
	}
}

function assert(cond: boolean, label: string): asserts cond {
	if (!cond) {
		throw new Error(label);
	}
}

function responseFetch(
	status: number,
	contentType: string,
	body: string,
): FetchFn {
	return () =>
		Promise.resolve(
			new Response(body, {
				status,
				headers: { "content-type": contentType },
			}),
		);
}

async function testHtmlBlockIsInconclusive(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: responseFetch(403, "text/html; charset=UTF-8", "<html/>"),
	});

	const verdict = await provider.verifyCredentials(openAiAccessToken());

	assert(
		verdict === "inconclusive",
		"HTML edge block 403 is inconclusive, not invalid",
	);
}

async function testJsonForbiddenIsInvalid(): Promise<void> {
	const provider = new OpenAiOAuthProvider({
		fetchFn: responseFetch(403, "application/json", '{"detail":"forbidden"}'),
	});

	const verdict = await provider.verifyCredentials(openAiAccessToken());

	assert(verdict === "invalid", "JSON API 403 stays invalid");
}

async function testVerifyEmitsEvent(): Promise<void> {
	const events: Array<{ event: string; fields: LogFields }> = [];
	const logger: Logger = {
		log: (_level, event, fields = {}) => {
			events.push({ event, fields });
		},
	};
	const provider = new OpenAiOAuthProvider({
		fetchFn: responseFetch(403, "text/html", "<html/>"),
		logger,
	});

	await provider.verifyCredentials(openAiAccessToken());

	const verify = events.find((event) => event.event === "SUBSCRIPTION_VERIFY");
	assert(verify !== undefined, "SUBSCRIPTION_VERIFY event emitted");
	assert(verify.fields.verdict === "inconclusive", "logged verdict");
	assert(verify.fields.status === 403, "logged upstream status");
}

async function main(): Promise<void> {
	await runTest("html_block_403_is_inconclusive", testHtmlBlockIsInconclusive);
	await runTest("json_forbidden_is_invalid", testJsonForbiddenIsInvalid);
	await runTest("verify_emits_event", testVerifyEmitsEvent);

	const report = { suite: "OpenAiVerifyClassification", results };
	process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
	if (results.some((result) => !result.ok)) {
		process.exit(1);
	}
}

void main();
