"use client";

import { memo, useState } from "react";
import { Add01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import type { AdminCreator } from "@/lib/admin/types";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import { creatorFromProfile, type AuthorProfile } from "@/lib/authors/profiles";
import { useAuthorProfiles } from "@/lib/authors/use-author-profiles";
import {
	adminFieldDescriptors,
	type AdminSchemaDefinition,
} from "./admin-schema";
import { CreatorCard, type CreatorMode } from "./CreatorCard";
import { AuthorPickerDialog } from "./AuthorPickerDialog";

export const CreatorsEditor = memo(function CreatorsEditor({
	definition,
	errors,
	onChange,
	payload,
	readOnly,
	recordKey,
}: {
	definition: AdminSchemaDefinition | undefined;
	errors: AdminFieldErrors;
	onChange: (payload: Record<string, unknown>) => void;
	payload: Record<string, unknown>;
	readOnly: boolean;
	recordKey: string;
}) {
	const creators = Array.isArray(payload.creators)
		? (payload.creators as AdminCreator[])
		: [];
	const catalog = useAuthorProfiles(creators);
	const [pickedProfiles, setPickedProfiles] = useState<
		Record<string, AuthorProfile>
	>({});
	const [modes, setModes] = useState<Record<number, CreatorMode>>({});
	const [picker, setPicker] = useState<number | null>(null);
	const profileFor = (creator: AdminCreator) => {
		if (!creator.authorProfileId) return undefined;
		const fetched = catalog.profiles.get(creator.authorProfileId);
		const picked = pickedProfiles[creator.authorProfileId];
		return picked && (!fetched || picked.revision > fetched.revision)
			? picked
			: fetched;
	};
	const modeFor = (creator: AdminCreator, index: number): CreatorMode =>
		creator.authorProfileId
			? "profile"
			: (modes[index] ??
				(creator.name || creator.firstName || creator.lastName
					? "manual"
					: "profile"));
	const replace = (index: number, creator: AdminCreator) =>
		onChange({
			...payload,
			creators: creators.map((row, i) => (i === index ? creator : row)),
		});
	const roles = definition?.creatorTypes ?? [];
	return (
		<div className="space-y-3">
			{creators.map((creator, index) => {
				const profile = profileFor(creator);
				return (
					<CreatorCard
						key={index}
						creator={creator}
						profile={profile}
						mode={modeFor(creator, index)}
						roles={roles}
						index={index}
						count={creators.length}
						readOnly={readOnly}
						errors={errors}
						profileLoading={
							!!creator.authorProfileId &&
							!profile &&
							catalog.isLoading
						}
						onRetryProfile={() => void catalog.mutate()}
						onChange={(next) =>
							replace(
								index,
								profile
									? creatorFromProfile(next, profile)
									: next,
							)
						}
						onModeChange={(mode) => {
							if (mode === modeFor(creator, index)) return;
							setModes({ ...modes, [index]: mode });
							if (mode === "profile") return;
							const next = profile
								? creatorFromProfile(creator, profile)
								: { ...creator };
							delete next.authorProfileId;
							replace(index, next);
						}}
						onPick={() => setPicker(index)}
						onMove={(direction) => {
							const target = index + direction;
							const next = [...creators];
							[next[index], next[target]] = [
								next[target]!,
								next[index]!,
							];
							setModes({
								...modes,
								[target]: modeFor(creator, index),
								[index]: modeFor(creators[target]!, target),
							});
							onChange({ ...payload, creators: next });
							requestAnimationFrame(() =>
								document
									.getElementById(`admin-creator-${target}`)
									?.focus(),
							);
						}}
						onRemove={() => {
							setModes(
								Object.fromEntries(
									creators.flatMap((row, i) =>
										i === index
											? []
											: [
													[
														i > index ? i - 1 : i,
														modeFor(row, i),
													],
												],
									),
								),
							);
							onChange({
								...payload,
								creators: creators.filter(
									(_, i) => i !== index,
								),
							});
						}}
					/>
				);
			})}
			{roles.length > 0 && (
				<Button
					id={`admin-${recordKey}-creators`}
					isDisabled={readOnly}
					size="xs"
					variant="muted"
					startContent={
						<HugeiconsIcon icon={Add01Icon} size={15} aria-hidden />
					}
					onPress={() => {
						setModes({ ...modes, [creators.length]: "profile" });
						onChange({
							...payload,
							creators: [
								...creators,
								{
									creatorType:
										roles.find((role) => role.primary)
											?.creatorType ??
										roles[0]!.creatorType,
									firstName: "",
									lastName: "",
								},
							],
						});
					}}
				>
					Add creator
				</Button>
			)}
			{picker !== null && !readOnly && creators[picker] && (
				<AuthorPickerDialog
					key={picker}
					open
					initialProfile={profileFor(creators[picker]!)}
					onClose={() => setPicker(null)}
					onSelect={(profile) => {
						setPickedProfiles({
							...pickedProfiles,
							[profile.id]: profile,
						});
						replace(
							picker,
							creatorFromProfile(creators[picker]!, profile),
						);
						setPicker(null);
					}}
				/>
			)}
		</div>
	);
});
