/*
 * Injectable fetch. Slices depend on this alias (default: the global fetch) so
 * tests can stub upstream/OIDC HTTP without a network.
 */

export type FetchFn = typeof fetch;

export const systemFetch: FetchFn = (input, init) => fetch(input, init);
