import { connection } from "next/server";
import { Suspense } from "react";

async function RequestMarker() {
	await connection();
	return null;
}

// Static page content can render immediately while tenant metadata resolves.
export default function RuntimeMetadata() {
	return (
		<Suspense fallback={null}>
			<RequestMarker />
		</Suspense>
	);
}
