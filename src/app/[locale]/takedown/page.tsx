import PageBoundary from "@/components/layout/PageBoundary";
import { getRuntimePageAvailability } from "@/config/library-config/pages";
import Takedown from "@/components/pages/Takedown";
import { getLibraryConfig } from "@/config/library-config/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

async function PageContent() {
	await connection();
	const config = await getLibraryConfig();

	if (!getRuntimePageAvailability(config)["/takedown"]) {
		return notFound();
	}

	return <Takedown />;
}

export default function Page() {
	return (
		<PageBoundary>
			<PageContent />
		</PageBoundary>
	);
}
