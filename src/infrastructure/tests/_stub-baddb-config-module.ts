/*
 * Fixture SPP_CONFIG module whose `database` member is not a function, so the
 * composition root rejects it with config_module_bad_shape (spp-db:CNT-002).
 */

const configModule = {
	database: "not-a-function",
};

export default configModule;
