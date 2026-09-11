import { getRuntimePageAvailability } from "@/config/library-config/pages";
import ContactComponent from "@/components/pages/Contact";
import { getLibraryConfig } from "@/config/library-config/server";
import { isEmailChannelEnabled } from "@/lib/nodemailer";
import { notFound } from "next/navigation";
import { connection } from "next/server";

export default async function Contact() {
	await connection();
	const config = await getLibraryConfig();

	if (!getRuntimePageAvailability(config)["/contact"]) {
		return notFound();
	}

	return <ContactComponent formEnabled={isEmailChannelEnabled(config, "contact")} />;
}
