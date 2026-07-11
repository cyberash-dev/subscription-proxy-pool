/*
 * Default Logger adapter: one JSON object per line to stderr, timestamped from
 * the injected Clock. The pod's stderr is collected by the platform, so these
 * lines are the operational trail for prod scenarios.
 */

import { systemClock, type Clock } from "../domain/Clock.ts";
import type { LogFields, Logger, LogLevel } from "./Logger.ts";

export type LogSink = (line: string) => void;

export class StderrJsonLogger implements Logger {
	private readonly clock: Clock;
	private readonly sink: LogSink;

	constructor(clock: Clock = systemClock, sink?: LogSink) {
		this.clock = clock;
		this.sink =
			sink ??
			((line) => {
				process.stderr.write(line);
			});
	}

	log(level: LogLevel, event: string, fields: LogFields = {}): void {
		const record = { ts: this.clock.nowIso(), level, event, ...fields };
		this.sink(`${JSON.stringify(record)}\n`);
	}
}
