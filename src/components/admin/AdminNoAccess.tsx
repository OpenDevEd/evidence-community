"use client";

import { useState } from "react";
import { Logout01Icon } from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { useReaderSession } from "@/components/layout/navbar/ReaderSession";

/** The answer for someone signed in whom OpenScholar gives no role in this library. */
export function AdminNoAccess({ organisationName }: { organisationName: string | null }) {
	const [signingOut, setSigningOut] = useState(false);
	const { switchAccount } = useReaderSession();
	return (
		<main id="main-content" className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
			<h1 className="text-2xl font-semibold text-foreground dark:text-white">You cannot open this admin area</h1>
			<p className="text-black/65 dark:text-white/65">
				{organisationName
					? `Ask an admin of ${organisationName} to add you to the team that runs this community.`
					: "Ask an admin of the organisation that runs this community to add you to its team."}
			</p>
			<Button
				isLoading={signingOut}
				startContent={<HugeiconsIcon icon={Logout01Icon} className="size-5" aria-hidden />}
				className="h-10 px-4 font-medium"
				onPress={() => {
					setSigningOut(true);
					void switchAccount();
				}}
			>
				Sign in with another account
			</Button>
		</main>
	);
}
