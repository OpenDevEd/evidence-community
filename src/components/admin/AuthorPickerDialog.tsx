"use client";

import { TruncatedText } from "@/components/nextui/TruncatedText";

import { useEffect, useId, useState } from "react";
import useSWR from "swr";
import {
	ModalContent,
	ModalHeader,
	ModalFooter,
} from "@nextui-org/react";
import { Spinner } from "@/components/nextui/Spinner";
import {
	Add01Icon,
	ArrowLeft01Icon,
	ArrowRight01Icon,
	Cancel01Icon,
	Search01Icon,
	Tick01Icon,
	UserIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import OpenScholar from "@/components/icons/OpenScholar";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
import { useDebounce } from "@/hooks/useDebounce";
import { loadAuthorPage, createAuthorProfile } from "./author-profile-catalog";
import type { AuthorProfile } from "@/lib/authors/profiles";
import { AuthorAffiliation } from "./CreatorCard";

/** A bounded page of results. The source owns searching and paging. */
export function AuthorPickerDialog({
	open,
	onClose,
	onSelect,
	initialProfile,
}: {
	open: boolean;
	onClose: () => void;
	onSelect: (profile: AuthorProfile) => void;
	initialProfile?: AuthorProfile;
}) {
	const state = useAuthorPicker({ open, onClose, initialProfile });
	const {
		nameId,
		search,
		changeSearch,
		cursors,
		setCursors,
		page,
		setPage,
		selected,
		setSelected,
		creating,
		name,
		setName,
		saving,
		error,
		catalog,
		busy,
		close,
	} = state;
	return (
		<DialogModal
			isOpen={open}
			onOpenChange={(value) => {
				if (!value) close();
			}}
			size="3xl"
			scrollBehavior="inside"
			classNames={{
				base: "!max-w-[820px] overflow-hidden rounded-2xl",
				wrapper: "items-center",
			}}
		>
			<ModalContent className="flex max-h-[calc(100dvh-32px)] flex-col">
				<ModalHeader
					aria-label={
						creating
							? "Create an author profile"
							: "Choose an author"
					}
					className="flex shrink-0 items-start gap-3 font-normal px-5 pb-4 pt-5 sm:px-6"
				>
					<span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/[0.065]">
						<OpenScholar className="size-7" aria-hidden />
					</span>
					<div className="min-w-0 flex-1">
						<h2
							className="text-lg font-semibold"
							id="creator-picker-title"
						>
							{creating
								? "Create an author profile"
								: "Choose an author"}
						</h2>
						<p className="mt-1 text-xs leading-relaxed text-black/50 dark:text-white/50">
							{creating
								? "Add their name now. Configure their profile in OpenScholar."
								: "Link an OpenScholar profile to keep this creator up to date."}
						</p>
					</div>
					<Button
						isIconOnly
						aria-label="Close author picker"
						variant="transparent"
						size="xs"
						onPress={close}
						isDisabled={saving}
						className="size-8 shrink-0 rounded-lg text-black/50 dark:text-white/50"
					>
						<HugeiconsIcon icon={Cancel01Icon} size={18} />
					</Button>
				</ModalHeader>
				{creating ? (
					<div className="flex min-h-[360px] flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-8">
						<AuthorAvatar
							name={name}
							className="w-20 h-20 rounded-2xl bg-black/[0.035] text-black/35 dark:bg-white/[0.05] dark:text-white/40"
						/>
						<div className="w-full max-w-sm space-y-2">
							<label
								htmlFor={nameId}
								className="block text-xs font-medium"
							>
								Full name
							</label>
							<Input
								color="filled"
								id={nameId}
								autoFocus
								aria-label="Full name"
								placeholder="Enter the author’s name"
								value={name}
								onValueChange={setName}
								classNames={{ inputWrapper: "h-11 rounded-xl" }}
							/>
						</div>
						{error && (
							<p role="alert" className="text-sm text-danger">
								{error}
							</p>
						)}
					</div>
				) : (
					<>
						<div className="shrink-0 px-5 pb-4 sm:px-6">
							<Input
								color="filled"
								autoFocus
								aria-label="Search OpenScholar authors"
								maxLength={200}
								placeholder="Search authors by name"
								value={search}
								onValueChange={changeSearch}
								startContent={
									<HugeiconsIcon
										icon={Search01Icon}
										size={18}
										className="shrink-0 text-black/40 dark:text-white/40"
									/>
								}
								endContent={
									busy ? (
										<Spinner
											size="sm"
											aria-label="Searching authors"
											classNames={{ wrapper: "size-4" }}
										/>
									) : search ? (
										<button
											type="button"
											aria-label="Clear author search"
											onClick={() => changeSearch("")}
										>
											<HugeiconsIcon
												icon={Cancel01Icon}
												size={15}
											/>
										</button>
									) : null
								}
								classNames={{
									inputWrapper: "h-11 min-h-11 rounded-xl",
									input: "text-sm",
								}}
							/>
						</div>
						<div className="grid min-h-0 flex-1 border-y border-black/[0.07] dark:border-white/[0.07] sm:grid-cols-[minmax(0,1fr)_280px]">
							<div className="flex min-h-0 min-w-0 flex-col">
								<div
									aria-label="Author search results"
									aria-busy={busy}
									className="h-[360px] min-h-40 overflow-y-auto overscroll-contain p-2 sm:h-[414px]"
								>
									<AuthorResults
										catalog={catalog}
										busy={busy}
										selected={selected}
										onSelect={setSelected}
									/>
								</div>
								<div className="flex h-14 shrink-0 items-center justify-between gap-3 border-t border-black/[0.055] px-4 dark:border-white/[0.06]">
									<span
										className="text-xs tabular-nums text-black/50 dark:text-white/50"
										aria-live="polite"
									>
										Page{" "}
										<span className="font-semibold text-black/75 dark:text-white/75">
											{page + 1}
										</span>
									</span>
									<div className="flex items-center gap-1.5">
										<Button
											aria-label="Previous author page"
											size="xs"
											variant="transparent"
											className="h-8 min-w-0 gap-1 rounded-lg px-2"
											isDisabled={page === 0 || busy}
											onPress={() => setPage(page - 1)}
											startContent={
												<HugeiconsIcon
													icon={ArrowLeft01Icon}
													size={14}
												/>
											}
										>
											Previous
										</Button>
										<Button
											aria-label="Next author page"
											size="xs"
											variant="transparent"
											className="h-8 min-w-0 gap-1 rounded-lg px-2"
											isDisabled={
												!catalog.data?.continueCursor ||
												busy
											}
											onPress={() => {
												const next =
													catalog.data
														?.continueCursor;
												if (next) {
													setCursors([
														...cursors.slice(
															0,
															page + 1,
														),
														next,
													]);
													setPage(page + 1);
												}
											}}
											endContent={
												<HugeiconsIcon
													icon={ArrowRight01Icon}
													size={14}
												/>
											}
										>
											Next
										</Button>
									</div>
								</div>
							</div>
							<SelectedAuthorPreview selected={selected} />
						</div>
					</>
				)}
				<AuthorPickerFooter state={state} onSelect={onSelect} />
			</ModalContent>
		</DialogModal>
	);
}

function SelectedAuthorPreview({ selected }: { selected?: AuthorProfile }) {
	return (
		<aside
			aria-label="Selected author preview"
			className="hidden min-h-0 overflow-y-auto border-l border-black/[0.065] bg-black/[0.018] p-5 dark:border-white/[0.065] dark:bg-white/[0.015] sm:block"
		>
			{selected ? (
				<>
					<AuthorAvatar
						src={selected.photo ?? undefined}
						name={selected.name}
						className="w-16 h-16 rounded-2xl bg-black/[0.045] text-black/35 dark:bg-white/[0.06] dark:text-white/40"
					/>
					<h3 className="mt-4 break-words text-lg font-semibold leading-snug">
						{selected.name}
					</h3>
					{selected.headline && (
						<p className="mt-2 text-xs leading-relaxed text-black/55 dark:text-white/55">
							{selected.headline}
						</p>
					)}
					<AuthorAffiliation
						affiliation={selected.affiliation}
						className="mt-4"
					/>
					{selected.bio && (
						<p className="mt-5 text-xs leading-6 text-black/60 dark:text-white/60">
							{selected.bio}
						</p>
					)}
					{selected.orcid && (
						<p className="mt-4 break-all text-xs tabular-nums text-black/45 dark:text-white/45">
							ORCID{" "}
							<span className="ml-1 font-medium text-black/65 dark:text-white/65">
								{selected.orcid}
							</span>
						</p>
					)}
				</>
			) : (
				<div className="flex h-full flex-col items-center justify-center gap-3 text-center">
					<HugeiconsIcon
						icon={UserIcon}
						size={30}
						className="text-black/20 dark:text-white/25"
					/>
					<p className="max-w-40 text-xs leading-relaxed text-black/45 dark:text-white/45">
						Select an author to see their profile.
					</p>
				</div>
			)}
		</aside>
	);
}

function AuthorResult({
	profile,
	selected,
	busy,
	onSelect,
}: {
	profile: AuthorProfile;
	selected: boolean;
	busy: boolean;
	onSelect: (profile: AuthorProfile) => void;
}) {
	return (
		<button
			type="button"
			key={profile.id}
			aria-pressed={selected}
			disabled={busy}
			onClick={() => onSelect(profile)}
			className={`flex min-h-[66px] w-full items-center gap-3 rounded-xl p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${selected ? "bg-accent/[0.085]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.035]"}`}
		>
			<AuthorAvatar
				src={profile.photo ?? undefined}
				name={profile.name}
				className="w-10 h-10 shrink-0 rounded-xl bg-black/[0.045] text-black/35 dark:bg-white/[0.06] dark:text-white/40"
			/>
			<span className="min-w-0 flex-1">
				<TruncatedText text={profile.name} className="text-sm font-semibold text-black/80 dark:text-white/85" />
				{(profile.affiliation || profile.headline) && (
					<TruncatedText text={profile.affiliation || profile.headline || ""} className="mt-1 text-xs text-black/45 dark:text-white/45" />
				)}
			</span>
			<span
				className={`grid size-5 shrink-0 place-items-center rounded-full ${selected ? "bg-accent text-white" : "border border-black/15 dark:border-white/15"}`}
			>
				{selected && (
					<HugeiconsIcon icon={Tick01Icon} size={13} aria-hidden />
				)}
			</span>
		</button>
	);
}

function AuthorResults({
	catalog,
	busy,
	selected,
	onSelect,
}: {
	catalog: ReturnType<
		typeof useSWR<Awaited<ReturnType<typeof loadAuthorPage>>>
	>;
	busy: boolean;
	selected?: AuthorProfile;
	onSelect: (profile: AuthorProfile) => void;
}) {
	const profiles = catalog.data?.profiles ?? [];
	return catalog.error ? (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
			<p className="text-sm text-black/60 dark:text-white/60">
				Could not load authors.
			</p>
			<Button size="sm" onPress={() => void catalog.mutate()}>
				Try again
			</Button>
		</div>
	) : !profiles.length ? (
		<div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
			{busy ? (
				<Spinner size="sm" aria-label="Loading author profiles" />
			) : (
				<>
					<HugeiconsIcon
						icon={Search01Icon}
						size={28}
						className="text-black/30 dark:text-white/30"
					/>
					<p className="text-sm font-medium">No authors found</p>
					<p className="max-w-60 text-xs leading-relaxed text-black/50 dark:text-white/50">
						Try another name, or create a profile below.
					</p>
				</>
			)}
		</div>
	) : (
		profiles.map((profile) => (
			<AuthorResult
				key={profile.id}
				profile={profile}
				selected={selected?.id === profile.id}
				busy={busy}
				onSelect={onSelect}
			/>
		))
	);
}

function useAuthorPicker({
	open,
	onClose,
	initialProfile,
}: {
	open: boolean;
	onClose: () => void;
	initialProfile?: AuthorProfile;
}) {
	const nameId = useId();
	const [search, setSearch] = useState("");
	const [query, setQuery] = useState("");
	const [cursors, setCursors] = useState<(string | null)[]>([null]);
	const [page, setPage] = useState(0);
	const [applySearch, , cancelSearch] = useDebounce((value: string) => {
		setQuery(value);
		setPage(0);
		setCursors([null]);
	}, 250);
	useEffect(() => cancelSearch, [cancelSearch]);
	const [selected, setSelected] = useState(initialProfile);
	const {
		creating,
		setCreating,
		name,
		setName,
		saving,
		setSaving,
		error,
		setError,
	} = useAuthorCreation();
	const cursor = cursors[page] ?? null;
	const catalog = useSWR(
		open && !creating ? ["author-catalog", query, cursor] : null,
		() => loadAuthorPage({ search: query, cursor }),
		{
			keepPreviousData: true,
			revalidateOnFocus: false,
			errorRetryCount: 1,
		},
	);
	const changeSearch = (value: string) => {
		setSelected(undefined);
		setSearch(value);
		applySearch(value);
	};
	const busy = search !== query || catalog.isValidating;
	const close = () => {
		if (!saving) onClose();
	};
	return {
		nameId,
		search,
		changeSearch,
		cursors,
		setCursors,
		page,
		setPage,
		selected,
		setSelected,
		creating,
		setCreating,
		name,
		setName,
		saving,
		setSaving,
		error,
		setError,
		catalog,
		busy,
		close,
	};
}

function AuthorPickerFooter({
	state,
	onSelect,
}: {
	state: ReturnType<typeof useAuthorPicker>;
	onSelect: (profile: AuthorProfile) => void;
}) {
	const {
		creating,
		setCreating,
		name,
		setName,
		search,
		saving,
		setSaving,
		setError,
		selected,
		busy,
		close,
	} = state;
	return (
		<ModalFooter className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
			<Button
				size="sm"
				variant="transparent"
				className="h-9 min-w-0 gap-1.5 rounded-xl px-2 text-xs text-black/60 dark:text-white/60"
				isDisabled={saving}
				onPress={() => {
					setCreating(!creating);
					setName(search);
					setError("");
				}}
				startContent={
					<HugeiconsIcon
						icon={creating ? ArrowLeft01Icon : Add01Icon}
						size={15}
					/>
				}
			>
				{creating ? "Back to search" : "Create profile"}
			</Button>
			<div className="ml-auto flex items-center gap-2">
				<Button
					size="sm"
					variant="transparent"
					className="h-9 rounded-xl text-xs"
					isDisabled={saving}
					onPress={close}
				>
					Cancel
				</Button>
				<Button
					size="sm"
					color="accent"
					className="h-9 gap-1.5 rounded-xl text-xs font-medium"
					isLoading={saving}
					isDisabled={creating ? !name.trim() : !selected || busy}
					startContent={
						<HugeiconsIcon
							icon={creating ? Add01Icon : Tick01Icon}
							size={15}
						/>
					}
					onPress={async () => {
						if (!creating) {
							if (selected && !busy) onSelect(selected);
							return;
						}
						setSaving(true);
						setError("");
						try {
							onSelect(await createAuthorProfile(name.trim()));
						} catch (error) {
							setError(
								error instanceof Error
									? error.message
									: "Could not create the profile.",
							);
						} finally {
							setSaving(false);
						}
					}}
				>
					{creating ? "Create and use profile" : "Use author"}
				</Button>
			</div>
		</ModalFooter>
	);
}

function useAuthorCreation() {
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	return {
		creating,
		setCreating,
		name,
		setName,
		saving,
		setSaving,
		error,
		setError,
	};
}
