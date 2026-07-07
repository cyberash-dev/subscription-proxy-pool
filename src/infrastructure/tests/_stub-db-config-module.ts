/*
 * Fixture SPP_CONFIG module for the config-module engine-selection test
 * (spp-db:CNT-002). Its default export selects a SQLite engine at a path derived
 * from SPP_HOME, so the test can assert database() overrides the env-default
 * pool.db.
 */

import { join } from "node:path";

import type { SppConfigModule } from "../SppConfigModule.ts";

const configModule: SppConfigModule = {
	database: () => ({
		engine: "sqlite",
		path: join(process.env.SPP_HOME ?? "", "override.db"),
	}),
};

export default configModule;
