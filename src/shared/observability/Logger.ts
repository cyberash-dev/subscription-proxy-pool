/*
 * Structured logging seam (internal observability, not an external contract).
 * Callers emit a SCREAMING_SNAKE event name with flat key/value fields; adapters
 * serialise them to a sink. Never pass secrets or raw tokens as field values.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogFields {
	readonly [key: string]: string | number | boolean;
}

export interface Logger {
	log(level: LogLevel, event: string, fields?: LogFields): void;
}

/* Default seam wiring: swallows events. Adapters replace it at the composition
   root; services depend only on the Logger port. */
export class NoopLogger implements Logger {
	log(): void {
		/* intentionally empty */
	}
}
