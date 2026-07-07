/*
 * Cross-cutting domain primitive: the set of subscription providers. Shared by
 * the subscription-oauth and subscriptions slices so neither reaches into the
 * other for the type. Extend here to add a provider (e.g. an inference vendor).
 */

export type ProviderId = "anthropic" | "openai";

export const PROVIDER_IDS: ReadonlyArray<ProviderId> = ["anthropic", "openai"];

export function isProviderId(value: string): value is ProviderId {
	return value === "anthropic" || value === "openai";
}
