/*
 * Anthropic-shaped error envelope + a typed carrier so any layer can raise an
 * HTTP-mappable failure without importing node:http. The proxy and management
 * servers translate `HttpError` into the wire response.
 */

export type AnthropicErrorType =
	| "authentication_error"
	| "invalid_request_error"
	| "not_found_error"
	| "rate_limit_error"
	| "overloaded_error"
	| "api_error";

export interface AnthropicErrorBody {
	readonly type: "error";
	readonly error: {
		readonly type: AnthropicErrorType;
		readonly message: string;
	};
}

export function errorBody(
	type: AnthropicErrorType,
	message: string,
): AnthropicErrorBody {
	return { type: "error", error: { type, message } };
}

export class HttpError extends Error {
	constructor(
		readonly status: number,
		readonly errorType: AnthropicErrorType,
		message: string,
		readonly retryAfterSeconds?: number,
	) {
		super(message);
		this.name = "HttpError";
	}

	body(): AnthropicErrorBody {
		return errorBody(this.errorType, this.message);
	}
}

export function unauthorized(message = "invalid credentials"): HttpError {
	return new HttpError(401, "authentication_error", message);
}

export function badRequest(message: string): HttpError {
	return new HttpError(400, "invalid_request_error", message);
}

export function notFound(message = "not found"): HttpError {
	return new HttpError(404, "not_found_error", message);
}

export function noCapacity(retryAfterSeconds: number): HttpError {
	return new HttpError(
		503,
		"overloaded_error",
		"no subscription capacity available in the target pool",
		retryAfterSeconds,
	);
}
