/* Upstream adapter over global fetch. Returns the Response so its body stream
 * relays without buffering. */

import { type FetchFn, systemFetch } from "../../../../shared/http/Fetch.ts";
import type {
	UpstreamGateway,
	UpstreamRequest,
} from "../../ports/outbound/UpstreamGateway.ts";

export class FetchUpstreamGateway implements UpstreamGateway {
	constructor(private readonly fetchFn: FetchFn = systemFetch) {}

	forward(request: UpstreamRequest): Promise<Response> {
		return this.fetchFn(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});
	}
}
