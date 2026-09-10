import { notFound } from "next/navigation";
import { connection } from "next/server";
import EmailPreviews from "@/components/previews/EmailPreviews";
import { getLibraryConfig } from "@/config/library-config/server";
import { libraryEmailPreviews } from "@/lib/emails/preview";

export default async function Page() {
	if (process.env.NODE_ENV !== "development") notFound();
	await connection();
	const config = await getLibraryConfig();
	return (
		<EmailPreviews
			editions={await libraryEmailPreviews(config)}
			senderEmail={config.contact.email ?? config.email.smtp.from ?? ""}
		/>
	);
}
