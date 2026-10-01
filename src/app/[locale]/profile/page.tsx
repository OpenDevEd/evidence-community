import { notFound } from "next/navigation";
import { connection } from "next/server";

import { redirect } from "@/i18n/routing";
import { getSignedInReader } from "@/lib/readers/session";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

/** The signed-in reader's own profile. */
export default async function OwnProfilePage(props: { params: Promise<{ locale: string }> }) {
	await connection();
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) notFound();
	const reader = await getSignedInReader(undefined, config);
	if (!reader) notFound();
	const { locale } = await props.params;
	redirect({ href: `/profile/${reader.id}`, locale });
}
