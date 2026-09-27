import { getRuntimePageAvailability } from "@/config/library-config/pages";
import Takedown from "@/components/pages/Takedown";
import { getLibraryConfig } from "@/config/library-config/server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

// Waits for the library settings instead of showing a loading state, so the click lands on the finished page.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export default async function Page() {
	await connection();
	const config = await getLibraryConfig();

	if (!getRuntimePageAvailability(config)["/takedown"]) {
		return notFound();
	}

	return <Takedown />;
}
