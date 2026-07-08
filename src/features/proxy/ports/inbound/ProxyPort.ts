/* Driving port for the inference proxy. The HTTP adapter parses the request and
 * relays the ProxyRelay the use case returns. */

export interface ProxyRequest {
	readonly bearer?: string;
	readonly path: string;
	readonly body: Record<string, unknown>;
	readonly clientBeta?: string;
	readonly wantStream: boolean;
}

export interface ProxyRelay {
	readonly status: number;
	readonly headers: Record<string, string>;
	readonly body: ReadableStream<Uint8Array> | null;
	/* Called by the adapter once the response has been fully relayed (or aborted)
	 * to release the chosen subscription's in-flight slot. */
	readonly release: () => void;
}

export interface ProxyPort {
	handle(request: ProxyRequest): Promise<ProxyRelay>;
}
