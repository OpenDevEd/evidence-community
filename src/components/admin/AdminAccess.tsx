import { LockKeyhole } from "lucide-react";

export function AdminAccess({
	error = false,
	loginPageUrl,
}: {
	error?: boolean;
	loginPageUrl: string;
}) {
	const message = error
		? "That admin link is invalid, expired, or has already been used. Return to OpenScholar and create a new one."
		: "Open this library from OpenScholar to administer it.";

	return (
		<main className="flex min-h-dvh items-center justify-center bg-background_light px-4 text-black dark:bg-background dark:text-white">
			<section className="w-full max-w-sm rounded-2xl bg-card_light p-6 shadow-xl dark:bg-card">
				<LockKeyhole
					aria-hidden
					className="mb-5 opacity-50"
					size={24}
				/>
				<h1 className="text-xl font-semibold">
					Library administration
				</h1>
				<p className="mt-2 text-sm opacity-60" role={error ? "alert" : undefined}>
					{message}
				</p>
				<a
					className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-accent px-4 font-semibold text-white"
					href={loginPageUrl}
				>
					Back to OpenScholar
				</a>
			</section>
		</main>
	);
}
