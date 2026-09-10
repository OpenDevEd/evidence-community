"use client";
import { useState } from "react";
import useSWR from "swr";
import {
	requestAuthorProfiles,
	type AuthorProfile,
} from "./author-profile-catalog";
import type { AdminCreator } from "@/lib/admin/types";
import {
	ModalBody,
	Spinner,
	ModalContent,
	ModalFooter,
	ModalHeader,
} from "@nextui-org/react";
import {
	Add01Icon,
	ArrowLeft01Icon,
	Cancel01Icon,
	Link01Icon,
	Search01Icon,
	UserCircleIcon,
	PencilIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
const blankProfile = (name: string): AuthorProfile => ({
	id: "",
	url: "",
	canEdit: true,
	name,
	affiliation: "",
	bio: "",
	orcid: "",
	openalex: "",
	website: "",
});
export function AuthorProfileLink({
	creator,
	onChange,
	readOnly,
}: {
	creator: AdminCreator;
	onChange: (creator: AdminCreator) => void;
	readOnly: boolean;
}) {
	const {
		open,
		setOpen,
		search,
		setSearch,
		selected,
		setSelected,
		creating,
		setCreating,
		error,
		setError,
		saving,
		catalog,
		linkedResult,
		profiles,
		linked,
		currentName,
		link,
		create,
	} = useAuthorProfileLink(creator, onChange);
	if (readOnly && !creator.authorProfileId) return null;
	return (
		<>
			<div className="mt-2 flex items-center gap-1">
				<Button
					size="xs"
					variant="transparent"
					className="h-7 min-w-0 px-1 text-[11px] text-black/50 dark:text-white/55"
					startContent={
						<HugeiconsIcon
							icon={linked ? UserCircleIcon : Link01Icon}
							size={14}
						/>
					}
					onPress={async () => {
						setOpen(true);
						setSelected(
							linked
								? readOnly
									? linked
									: (profiles.find(
											(p) => p.id === linked.id,
										) ?? linked)
								: null,
						);
						setCreating(false);
						setError("");
						setSearch(linked ? "" : currentName);
						if (creator.authorProfileId && !linked) {
							try {
								const result = await linkedResult.mutate();
								setSelected(result?.profiles[0] ?? null);
							} catch {
								setError(
									"Unable to load the linked profile. Try again shortly.",
								);
							}
						}
					}}
				>
					{linked
						? `${linked.name} · OpenScholar`
						: creator.authorProfileId
							? "Linked author profile"
							: "Link author profile"}
				</Button>
				{linked && !readOnly && (
					<Button
						size="xs"
						isIconOnly
						variant="transparent"
						aria-label="Unlink author profile"
						className="size-6 min-w-6 text-black/35 dark:text-white/35"
						onPress={() => {
							const { authorProfileId: _, ...unlinked } = creator;
							onChange(unlinked);
						}}
					>
						<HugeiconsIcon icon={Cancel01Icon} size={12} />
					</Button>
				)}
			</div>
			<DialogModal
				isOpen={open}
				onOpenChange={setOpen}
				size="lg"
				scrollBehavior="inside"
			>
				<ModalContent>
					<ModalHeader className="flex items-center gap-2">
						{selected && !readOnly && (
							<Button
								isIconOnly
								size="xs"
								variant="transparent"
								aria-label="Back to author search"
								onPress={() => {
									setSelected(null);
									setCreating(false);
									setError("");
								}}
							>
								<HugeiconsIcon
									icon={ArrowLeft01Icon}
									size={16}
								/>
							</Button>
						)}
						<span className="flex-1">
							{profileDialogTitle(creating, selected)}
						</span>
						<Button
							isIconOnly
							size="xs"
							variant="transparent"
							aria-label="Close author profiles"
							onPress={() => setOpen(false)}
						>
							<HugeiconsIcon icon={Cancel01Icon} size={17} />
						</Button>
					</ModalHeader>
					<ModalBody className="gap-4">
						{error && !creating && (
							<p role="alert" className="text-xs text-danger">
								{error}
							</p>
						)}
						{creating && selected ? (
							<CreateAuthorFields
								selected={selected}
								setSelected={setSelected}
								error={error}
							/>
						) : selected ? (
							<AuthorProfileDetails
								selected={selected}
								readOnly={readOnly}
							/>
						) : (
							<AuthorProfileSearch
                                profiles={profiles}
								search={search}
								setSearch={setSearch}
								setSelected={setSelected}
								error={catalog.error}
								isLoading={catalog.isLoading}
							/>
						)}
					</ModalBody>
					<AuthorProfileActions
						readOnly={readOnly}
						creating={creating}
						selected={selected}
						saving={saving}
						onClose={() => setOpen(false)}
						onCreate={() => {
							setSelected(
								selected ?? blankProfile(search || currentName),
							);
							setCreating(true);
						}}
						onLink={() => {
							if (selected) link(selected);
						}}
						onSubmit={create}
					/>
				</ModalContent>
			</DialogModal>
		</>
	);
}

function CreateAuthorFields({selected, setSelected, error}: {
  selected: AuthorProfile;
  setSelected: (profile: AuthorProfile) => void;
  error: string;
}) {
  return <>
    <Input label="Name" value={selected.name}
      onValueChange={(name) => setSelected({...selected, name})} isRequired />
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
  </>;
}
function AuthorProfileDetails({
	selected,
	readOnly,
}: {
	selected: AuthorProfile;
	readOnly: boolean;
}) {
	return (
		<>
			<div className="flex items-center gap-4">
				<span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent/[0.07] text-lg font-medium text-accent-700 dark:text-accent-300">
					{selected.name
						.split(/\s+/)
						.map((n) => n[0])
						.slice(0, 2)
						.join("")}
				</span>
				<div>
					<h3 className="text-lg font-semibold">{selected.name}</h3>
					<p className="mt-1 text-sm text-black/50 dark:text-white/50">
						{selected.affiliation || "No affiliation added"}
					</p>
				</div>
			</div>
			<p className="text-sm leading-relaxed text-black/65 dark:text-white/65">
				{selected.bio || "No biography added yet."}
			</p>
			<dl className="space-y-2 text-xs">
				{[
					["ORCID", selected.orcid],
					["OpenAlex", selected.openalex],
					["Website", selected.website],
				]
					.filter(([, value]) => value)
					.map(([label, value]) => (
						<div key={label} className="flex gap-4">
							<dt className="w-16 shrink-0 text-black/40 dark:text-white/40">
								{label}
							</dt>
							<dd className="break-all">{value}</dd>
						</div>
					))}
			</dl>
			<a
				href={selected.url}
				target="_blank"
				rel="noreferrer"
				className="text-xs underline"
			>
				Open full profile in OpenScholar
			</a>
			{readOnly && (
				<p className="text-[11px] text-black/40 dark:text-white/40">
					This version links to this OpenScholar profile.
				</p>
			)}
		</>
	);
}
function AuthorProfileSearch({
	search,
	setSearch,
	profiles,
	setSelected,
	error,
	isLoading,
}: {
	search: string;
	setSearch: (search: string) => void;
	profiles: AuthorProfile[];
	setSelected: (profile: AuthorProfile) => void;
	error: unknown;
	isLoading: boolean;
}) {
	return (
		<>
			<Input
				aria-label="Search author profiles"
				placeholder="Search OpenScholar authors"
				value={search}
				onValueChange={setSearch}
				isClearable
				onClear={() => setSearch("")}
				startContent={<HugeiconsIcon icon={Search01Icon} size={15} />}
			/>
			<div className="space-y-1">
				{profiles.map((profile) => (
					<button
						type="button"
						key={profile.id}
						onClick={() => setSelected(profile)}
						className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-black/[0.035] dark:hover:bg-white/[0.04]"
					>
						<span className="grid size-9 shrink-0 place-items-center rounded-full bg-black/[0.04] text-xs text-black/50 dark:bg-white/[0.05] dark:text-white/50">
							{profile.name
								.split(/\s+/)
								.map((n) => n[0])
								.slice(0, 2)
								.join("")}
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-medium">
								{profile.name}
							</span>
							<span className="mt-0.5 block truncate text-xs text-black/45 dark:text-white/45">
								{profile.affiliation}
							</span>
						</span>
					</button>
				))}
				{isLoading ? (
					<div className="flex min-h-24 items-center justify-center"><Spinner aria-label="Loading author profiles" size="sm" /></div>
				) : !profiles.length && (
					<p className="py-6 text-center text-sm text-black/45 dark:text-white/45">
						{error
							? "Unable to load author profiles. Try again shortly."
							: "No matching author profiles."}
					</p>
				)}
			</div>
		</>
	);
}

function useAuthorProfileLink(
	creator: AdminCreator,
	onChange: (creator: AdminCreator) => void,
) {
	const [open, setOpen] = useState(false),
		[search, setSearch] = useState("");
	const [selected, setSelected] = useState<AuthorProfile | null>(null),
		[creating, setCreating] = useState(false);
	const [error, setError] = useState("");
	const [saving, setSaving] = useState(false);
	const catalog = useSWR(
		open ? ["author-catalog", search] : null,
		([, search]) => requestAuthorProfiles({ operation: "search", search }),
	);
	const linkedResult = useSWR(
		creator.authorProfileId
			? ["author-profile", creator.authorProfileId]
			: null,
		([, profileId]) =>
			requestAuthorProfiles({
				operation: "search",
				search: "",
				profileId,
			}),
	);
	const profiles = catalog.data?.profiles ?? [];
	const linked = linkedResult.data?.profiles[0];
	const currentName =
		creator.name ??
		`${creator.firstName ?? ""} ${creator.lastName ?? ""}`.trim();
	const link = (profile: AuthorProfile) => {
		onChange({
			...creator,
			authorProfileId: profile.id,
		});
		setOpen(false);
	};
	const create = async () => {
		if (saving) return;
		if (!selected?.name.trim()) {
			setError("Enter the author’s name.");
			return;
		}
		setSaving(true);
		setError("");
		try {
			const result = await requestAuthorProfiles({
				operation: "create",
                name: selected.name,
			});
			const saved = result.profiles[0];
			if (!saved) throw new Error("Author profile was not returned");
			await catalog.mutate();
			link(saved);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Unable to create author profile",
			);
		} finally {
			setSaving(false);
		}
	};
	return {
		open,
		setOpen,
		search,
		setSearch,
		selected,
		setSelected,
		creating,
		setCreating,
		error,
		setError,
		saving,
		catalog,
		linkedResult,
		profiles,
		linked,
		currentName,
		link,
		create,
	};
}

function AuthorProfileActions({
	readOnly,
	creating,
	selected,
	saving,
	onClose,
	onCreate,
	onLink,
	onSubmit,
}: {
	readOnly: boolean;
	creating: boolean;
	selected: AuthorProfile | null;
	saving: boolean;
	onClose: () => void;
	onCreate: () => void;
	onLink: () => void;
	onSubmit: () => Promise<void>;
}) {
	return (
		<ModalFooter className="justify-between">
            {!readOnly && !creating && (selected ? selected.canEdit && (
              <Button as="a" role="link" href={`${selected.url}/configuration`} target="_blank" rel="noreferrer"
                size="sm" variant="transparent" startContent={<HugeiconsIcon icon={PencilIcon} size={14} />}>
                Configure profile
              </Button>
            ) : (
              <Button size="sm" variant="transparent" startContent={<HugeiconsIcon icon={Add01Icon} size={14} />}
                onPress={onCreate}>Create profile</Button>
            ))}
			{readOnly ? (
				<Button size="sm" variant="transparent" onPress={onClose}>
					Close
				</Button>
			) : (
				selected && (
					<Button
						size="sm"
						color="accent"
						startContent={
							<HugeiconsIcon icon={Link01Icon} size={14} />
						}
						className="ml-auto"
						isLoading={saving}
						onPress={() => (creating ? void onSubmit() : onLink())}
					>
						{creating ? "Create and link profile" : "Link this author"}
					</Button>
				)
			)}
		</ModalFooter>
	);
}

function profileDialogTitle(creating: boolean, selected: AuthorProfile | null) {
  if (creating) return "Create author profile";
  return selected ? "Author profile" : "Link author profile";
}
