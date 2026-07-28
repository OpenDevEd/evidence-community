import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

import ProfileRedirect from "./ProfileRedirect";

export default async function ProfilePage(props: {
	params: Promise<{ locale: string }>;
}) {
	await connection();
	const config = await getConfigForEnabledFeature("login");
	if (!config) notFound();

	const { locale } = await props.params;
	return <ProfileRedirect locale={locale} />;
}
