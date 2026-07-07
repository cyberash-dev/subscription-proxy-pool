/* SQLite adapter for load snapshots (spp-load-monitor). */

import type { Engine } from "../../../../shared/db/Engine.ts";
import type {
	LoadSnapshot,
	LoadSource,
	RepresentativeWindow,
	UnifiedStatus,
} from "../../../../shared/domain/Load.ts";
import { newUuid } from "../../../../shared/domain/Scalars.ts";
import type { LoadRepository } from "../../ports/outbound/LoadRepository.ts";

/* eslint-disable-next-line max-properties-per-class/max-properties -- one field per DB column; reshaping the row is a schema/spec change, not a lint refactor */
interface Row {
	readonly subscription_id: string;
	readonly sampled_at: string;
	readonly source: LoadSource;
	readonly unified_status: UnifiedStatus | null;
	readonly representative: RepresentativeWindow | null;
	readonly util_5h: number | null;
	readonly reset_5h: number | null;
	readonly status_5h: string | null;
	readonly util_7d: number | null;
	readonly reset_7d: number | null;
	readonly status_7d: string | null;
	readonly retry_after_s: number | null;
	readonly cooldown_until: number | null;
	readonly http_status: number | null;
}

function toSnapshot(row: Row): LoadSnapshot {
	return {
		subscriptionId: row.subscription_id,
		sampledAt: row.sampled_at,
		source: row.source,
		unifiedStatus: row.unified_status ?? undefined,
		representative: row.representative ?? undefined,
		util5h: row.util_5h ?? undefined,
		reset5h: row.reset_5h ?? undefined,
		status5h: row.status_5h ?? undefined,
		util7d: row.util_7d ?? undefined,
		reset7d: row.reset_7d ?? undefined,
		status7d: row.status_7d ?? undefined,
		retryAfterS: row.retry_after_s ?? undefined,
		cooldownUntil: row.cooldown_until ?? undefined,
		httpStatus: row.http_status ?? undefined,
	};
}

export class SqliteLoadRepository implements LoadRepository {
	constructor(private readonly engine: Engine) {}

	async insertSnapshot(snapshot: LoadSnapshot): Promise<void> {
		await this.engine.run(
			`INSERT INTO subscription_load(load_id, subscription_id, sampled_at, source,
			   unified_status, representative, util_5h, reset_5h, status_5h,
			   util_7d, reset_7d, status_7d, retry_after_s, cooldown_until, http_status)
			 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				newUuid(),
				snapshot.subscriptionId,
				snapshot.sampledAt,
				snapshot.source,
				snapshot.unifiedStatus ?? null,
				snapshot.representative ?? null,
				snapshot.util5h ?? null,
				snapshot.reset5h ?? null,
				snapshot.status5h ?? null,
				snapshot.util7d ?? null,
				snapshot.reset7d ?? null,
				snapshot.status7d ?? null,
				snapshot.retryAfterS ?? null,
				snapshot.cooldownUntil ?? null,
				snapshot.httpStatus ?? null,
			],
		);
	}

	async latestBySubscription(
		subscriptionId: string,
	): Promise<LoadSnapshot | undefined> {
		const row = await this.engine.get<Row>(
			"SELECT * FROM subscription_load WHERE subscription_id = ? ORDER BY sampled_at DESC LIMIT 1",
			[subscriptionId],
		);
		return row === undefined ? undefined : toSnapshot(row);
	}
}
