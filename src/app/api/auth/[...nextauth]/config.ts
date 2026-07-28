import { getDatabaseForConfig } from "@/db";
import { userCollection } from "@/db/schema/tables/userCollection";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { InferSelectModel } from "drizzle-orm";
import NextAuth, {
	type NextAuthConfig,
	type Session,
	type User,
} from "next-auth";
import { NextRequest } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { buildAuthOptions } from "@/lib/auth-options";
import {
	authorizeForConfig,
	getProfileForConfig,
} from "@/lib/auth-service";
import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

declare module "next-auth" {
	interface Session {
		user: {
			likes: {
				[key: string]: Date;
			};
			following: {
				[key: string]: Date;
			};
			followers: {
				[key: string]: Date;
			};
			collections: InferSelectModel<typeof userCollection>[];
			id: string;
			createdAt?: Date;
			itemsCollections: {
				[key: string]: {
					[key: string]: Date;
				};
			};
		} & User;
	}
}

export async function getAuthOptions(): Promise<NextAuthConfig> {
	const config = await getLibraryConfig();
	if (!config.features.login) {
		return buildAuthOptions(config);
	}

	const adapter = DrizzleAdapter(
		await getDatabaseForConfig(config),
	);

	return buildAuthOptions(config, {
		adapter,
		async authorize(credentials) {
			const user = await authorizeForConfig(
				credentials,
				config,
			);
			return "error" in user ? null : user;
		},
		getProfile: (userId, session) =>
			getProfileForConfig(userId, session, config),
	});
}

const runtimeAuth = NextAuth(getAuthOptions);

function withConfiguredOrigin(
	request: NextRequest,
	baseUrl: string,
) {
	const requestUrl = new URL(request.url);
	const configuredUrl = new URL(
		requestUrl.pathname + requestUrl.search,
		baseUrl,
	);
	return new NextRequest(configuredUrl, request);
}

export async function auth(): Promise<Session | null> {
	const config = await getConfigForEnabledFeature("login");
	if (!config) return null;
	return runtimeAuth.auth();
}

export const handlers = {
	async GET(request: Parameters<typeof runtimeAuth.handlers.GET>[0]) {
		const config = await getConfigForEnabledFeature("login");
		if (!config) return featureUnavailableResponse();
		return runtimeAuth.handlers.GET(
			withConfiguredOrigin(request, config.identity.baseUrl),
		);
	},
	async POST(request: Parameters<typeof runtimeAuth.handlers.POST>[0]) {
		const config = await getConfigForEnabledFeature("login");
		if (!config) return featureUnavailableResponse();
		return runtimeAuth.handlers.POST(
			withConfiguredOrigin(request, config.identity.baseUrl),
		);
	},
};
