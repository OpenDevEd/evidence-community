import { notFound } from "next/navigation";
import { connection } from "next/server";

import { redirect } from "@/i18n/routing";
import { getSignedInReader } from "@/lib/readers/session";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

// Only redirects, so there is nothing to show while it waits.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

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
