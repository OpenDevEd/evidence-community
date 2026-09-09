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
import { Textarea } from "@/components/nextui/Textarea";
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
		editing,
		setEditing,
		error,
		setError,
		saving,
		catalog,
		linkedResult,
		profiles,
		linked,
		currentName,
		link,
		save,
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
						setEditing(false);
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
									setEditing(false);
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
							{profileDialogTitle(editing, selected, profiles)}
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
						{error && !editing && (
							<p role="alert" className="text-xs text-danger">
								{error}
							</p>
						)}
						{editing && selected ? (
							<AuthorProfileFields
								selected={selected}
								setSelected={setSelected}
								profiles={profiles}
								error={error}
							/>
						) : selected ? (
							<AuthorProfileDetails
								selected={selected}
								readOnly={readOnly}
							/>
						) : (
							<AuthorProfileSearch
								search={search}
								setSearch={setSearch}
								profiles={profiles}
								setSelected={setSelected}
								error={catalog.error}
								isLoading={catalog.isLoading}
							/>
						)}
					</ModalBody>
					<AuthorProfileActions
						readOnly={readOnly}
						editing={editing}
						selected={selected}
						saving={saving}
						onClose={() => setOpen(false)}
						onEdit={() => {
							setSelected(
								selected ?? blankProfile(search || currentName),
							);
							setEditing(true);
						}}
						onLink={() => {
							if (selected) link(selected);
						}}
						onSave={save}
					/>
				</ModalContent>
			</DialogModal>
		</>
	);
}

function AuthorProfileFields({
	selected,
	setSelected,
	profiles,
	error,
}: {
	selected: AuthorProfile;
	setSelected: (profile: AuthorProfile) => void;
	profiles: AuthorProfile[];
	error: string;
}) {
	return (
		<>
			<p className="text-xs text-black/45 dark:text-white/45">
				This OpenScholar profile can be linked from any Evidence
				Library.
			</p>
			<Input
				label="Full name"
				value={selected.name}
				onValueChange={(name) => setSelected({ ...selected, name })}
				isRequired
			/>
			<Input
				label="Affiliation"
				value={selected.affiliation}
				onValueChange={(affiliation) =>
					setSelected({
						...selected,
						affiliation,
					})
				}
				placeholder="Organisation or institution"
			/>
			<Textarea
				label="Biography"
				value={selected.bio}
				onValueChange={(bio) => setSelected({ ...selected, bio })}
				minRows={3}
			/>
			<div className="grid gap-3 sm:grid-cols-2">
				<Input
					label="ORCID"
					value={selected.orcid}
					onValueChange={(orcid) =>
						setSelected({ ...selected, orcid })
					}
					placeholder="0000-0000-0000-0000"
				/>
				<div className="self-center text-xs text-black/50 dark:text-white/50">
					OpenAlex: {selected.openalex || "Not linked"}
				</div>
			</div>
			{profiles.some((p) => p.id === selected.id) ? (
				<p className="text-xs text-black/50 dark:text-white/50">
					<a
						href={selected.url}
						target="_blank"
						rel="noreferrer"
						className="underline"
					>
						Open full profile
					</a>{" "}
					to manage photos, profile access and OpenAlex matches.
				</p>
			) : (
				<p className="text-xs text-black/50 dark:text-white/50">
					Save this profile first, then open it in OpenScholar to add
					a photo or match it to OpenAlex.
				</p>
			)}
			<Input
				label="Website"
				value={selected.website}
				onValueChange={(website) =>
					setSelected({ ...selected, website })
				}
				placeholder="https://"
			/>
			{error && (
				<p role="alert" className="text-xs text-danger">
					{error}
				</p>
			)}
		</>
	);
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
				{!profiles.length && (
					<p className="py-6 text-center text-sm text-black/45 dark:text-white/45">
						{error
							? "Unable to load author profiles. Try again shortly."
							: isLoading
								? "Loading author profiles…"
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
		[editing, setEditing] = useState(false);
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
	const save = async () => {
		if (saving) return;
		if (!selected?.name.trim()) {
			setError("Enter the author’s name.");
			return;
		}
		setSaving(true);
		setError("");
		try {
			const result = await requestAuthorProfiles({
				operation: "save",
				...(selected.id
					? {
							profileId: selected.id,
							expectedRevision: selected.revision,
						}
					: {}),
				name: selected.name,
				affiliation: selected.affiliation,
				bio: selected.bio,
				orcid: selected.orcid,
				website: selected.website,
			});
			const saved = result.profiles[0];
			if (!saved) throw new Error("Author profile was not returned");
			await catalog.mutate();
			if (saved.id === creator.authorProfileId)
				await linkedResult.mutate();
			link(saved);
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: "Unable to save author profile",
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
		editing,
		setEditing,
		error,
		setError,
		saving,
		catalog,
		linkedResult,
		profiles,
		linked,
		currentName,
		link,
		save,
	};
}

function AuthorProfileActions({
	readOnly,
	editing,
	selected,
	saving,
	onClose,
	onEdit,
	onLink,
	onSave,
}: {
	readOnly: boolean;
	editing: boolean;
	selected: AuthorProfile | null;
	saving: boolean;
	onClose: () => void;
	onEdit: () => void;
	onLink: () => void;
	onSave: () => Promise<void>;
}) {
	return (
		<ModalFooter className="justify-between">
			{canEditProfile(readOnly, editing, selected) && (
				<Button
					size="sm"
					variant="transparent"
					startContent={
						<HugeiconsIcon
							icon={selected ? PencilIcon : Add01Icon}
							size={14}
						/>
					}
					onPress={onEdit}
				>
					{selected ? "Edit profile" : "Create profile"}
				</Button>
			)}
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
						onPress={() => (editing ? void onSave() : onLink())}
					>
						{editing ? "Save and link profile" : "Link this author"}
					</Button>
				)
			)}
		</ModalFooter>
	);
}

function profileDialogTitle(
	editing: boolean,
	selected: AuthorProfile | null,
	profiles: AuthorProfile[],
) {
	if (editing)
		return profiles.some((profile) => profile.id === selected?.id)
			? "Edit author profile"
			: "Create author profile";
	return selected ? "Author profile" : "Link author profile";
}

function canEditProfile(
	readOnly: boolean,
	editing: boolean,
	selected: AuthorProfile | null,
) {
	return !readOnly && !editing && (!selected || selected.canEdit);
}
