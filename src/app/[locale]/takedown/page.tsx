import Takedown from "@/components/pages/Takedown";
import { getLibraryConfig } from "@/config/library-config/server";
import { isEmailChannelEnabled } from "@/lib/nodemailer";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function Page() {
	await connection();
	const config = await getLibraryConfig();

	if (!isEmailChannelEnabled(config, "takedown")) {
		return notFound();
	}

	return <Takedown />;
}
