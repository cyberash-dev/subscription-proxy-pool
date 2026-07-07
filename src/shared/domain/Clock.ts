/*
 * Injectable time source. Selection, cooldown and prober logic read time
 * through this port so tests are deterministic (no real wall clock).
 */

export interface Clock {
	/* Milliseconds since the Unix epoch. */
	nowMs(): number;
	/* Current instant as an ISO-8601 string. */
	nowIso(): string;
}

export const systemClock: Clock = {
	nowMs: () => Date.now(),
	nowIso: () => new Date().toISOString(),
};

/* A clock pinned to a fixed instant, advanceable in tests. */
export class FakeClock implements Clock {
	constructor(private ms: number) {}

	nowMs(): number {
		return this.ms;
	}

	nowIso(): string {
		return new Date(this.ms).toISOString();
	}

	advance(ms: number): void {
		this.ms += ms;
	}

	set(ms: number): void {
		this.ms = ms;
	}
}
