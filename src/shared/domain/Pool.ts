/*
 * Cross-cutting pool primitives. `PoolKind` labels where a subscription lives
 * (a user's own pool, or the shared donor pool). `PoolTarget` labels which pool
 * a proxy key draws from. They share the `donor` value but are distinct axes.
 */

export type PoolKind = "user" | "donor";

export type PoolTarget = "own" | "donor";
