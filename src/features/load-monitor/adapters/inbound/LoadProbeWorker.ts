/*
 * Background prober (spp-load-monitor:BEH-003). setInterval-driven, unref'd so
 * it never blocks shutdown, with an overlap guard so a slow sweep never stacks.
 */

import type { LoadMonitorPort } from "../../ports/inbound/LoadMonitorPort.ts";

export class LoadProbeWorker {
	private timer: ReturnType<typeof setInterval> | undefined;
	private running = false;

	constructor(
		private readonly monitor: LoadMonitorPort,
		private readonly periodMs: number,
	) {}

	start(): void {
		if (this.timer !== undefined) {
			return;
		}
		this.timer = setInterval(() => {
			void this.tick();
		}, this.periodMs);
		this.timer.unref();
	}

	stop(): void {
		if (this.timer !== undefined) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
	}

	private async tick(): Promise<void> {
		if (this.running) {
			return;
		}
		this.running = true;
		try {
			await this.monitor.probeIdle();
		} catch {
			/* the worker keeps ticking; per-subscription errors are handled inside */
		} finally {
			this.running = false;
		}
	}
}
