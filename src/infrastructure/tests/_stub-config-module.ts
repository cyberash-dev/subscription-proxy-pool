/*
 * Fixture SPP_CONFIG module for the config-module injection test
 * (spp-auth:CNT-002). Its default export registers a stub identity provider so
 * the test can assert the provider is merged into the registry and resolvable.
 */

import type { SppConfigModule } from "../SppConfigModule.ts";

const configModule: SppConfigModule = {
	identityProviders: () => ({
		"stub-provider": {
			name: "stub-provider",
			buildAuthorizeUrl: (input) =>
				Promise.resolve(`https://stub.test/authorize?state=${input.state}`),
			exchangeCode: () =>
				Promise.resolve({
					issuer: "https://stub.test",
					subject: "stub-subject",
				}),
		},
	}),
};

export default configModule;
