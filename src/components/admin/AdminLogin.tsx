import { LockKeyhole } from "lucide-react";

const messages = {
	invalid: "That password is not correct.",
	limited: "Too many attempts. Wait five minutes and try again.",
	unavailable: "Admin access is not configured.",
} as const;

export function AdminLogin({
	status,
}: {
	status: string | string[] | undefined;
}) {
	const key = Array.isArray(status) ? status[0] : status;
	const message =
		key && key in messages ? messages[key as keyof typeof messages] : null;

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
				<p className="mt-2 text-sm opacity-60">
					Enter the admin password to continue.
				</p>
				<form
					action="/api/admin/session"
					className="mt-6 flex flex-col gap-4"
					method="post"
				>
					<label className="flex flex-col gap-2 text-sm font-medium">
						Admin password
						<input
							autoComplete="current-password"
							autoFocus
							className="min-h-11 rounded-xl border border-black/10 bg-transparent px-3 outline-none focus-visible:ring-2 focus-visible:ring-focus dark:border-white/10"
							name="password"
							required
							type="password"
						/>
					</label>
					{message ? (
						<p role="alert" className="text-sm text-danger">
							{message}
						</p>
					) : null}
					<button
						className="min-h-11 rounded-xl bg-accent px-4 font-semibold text-white"
						type="submit"
					>
						Continue
					</button>
				</form>
			</section>
		</main>
	);
}
