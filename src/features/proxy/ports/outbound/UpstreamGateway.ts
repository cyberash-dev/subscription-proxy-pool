/* Driven port for the upstream (api.anthropic.com) call. Returns a standard
 * web Response so the body stream can be relayed without buffering. */

export interface UpstreamRequest {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: string;
}

export interface UpstreamGateway {
	forward(request: UpstreamRequest): Promise<Response>;
}
