"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { AlertCircleIcon, CheckmarkBadge01Icon, DatabaseIcon } from "@hugeicons/core-free-icons";
import type { ZenodoIdentifierPolicy } from "@/db/schema/publication";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	ModalHeader,
	Radio,
	RadioGroup,
} from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import type { AdminFieldErrors } from "@/lib/admin/errors";
import type { AdminPublicationView } from "@/lib/publication/admin-publication-view";

function ActivationError({
	error,
	fieldErrors,
}: {
	error: string | null;
	fieldErrors: AdminFieldErrors;
}) {
	if (!error) return null;
	return (
		<div className="rounded-xl bg-danger/[0.08] p-3 text-xs text-danger" role="alert">
			<p className="font-medium">{error}</p>
			{Object.entries(fieldErrors).length > 0 ? (
				<ul className="mt-1.5 list-disc space-y-1 pl-4">
					{Object.entries(fieldErrors).map(([path, message]) => (
						<li key={path}>{message}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

export function AdminCrossrefActivation({
	busy,
	error,
	fieldErrors,
	isOpen,
	onConfirm,
	onOpenChange,
	publication,
}: {
	busy: boolean;
	error: string | null;
	fieldErrors: AdminFieldErrors;
	isOpen: boolean;
	onConfirm: () => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	publication: AdminPublicationView;
}) {
	const existingDoi =
		publication.bibliographicDoi.status === "resolved"
			? publication.bibliographicDoi.doi
			: null;
	const namespace = publication.doiNamespace;

	return (
		<DialogModal
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			size="sm"
		>
			<ModalContent>
				{(onClose) => (
					<>
						<ModalHeader className="px-4 pb-2 pt-4 text-base font-semibold">
							Activate Crossref DOI
						</ModalHeader>
						<ModalBody className="gap-3 px-4 py-2">
							<ActivationError error={error} fieldErrors={fieldErrors} />
							<div className="flex items-start gap-3 rounded-xl bg-black/[0.035] p-3 dark:bg-white/[0.045]">
								<HugeiconsIcon icon={CheckmarkBadge01Icon} aria-hidden className="mt-0.5 shrink-0 text-accent" size={16} />
								<div className="min-w-0">
									<p className="text-xs font-medium text-black/50 dark:text-white/50">
										{existingDoi ? "DOI to register" : "New DOI namespace"}
									</p>
									<p className="mt-1 break-all font-mono text-sm font-semibold text-black/85 dark:text-white/90">
										{existingDoi ??
											(namespace
												? `${namespace.prefix}/${namespace.suffixNamespace}…`
												: "Not configured")}
									</p>
								</div>
							</div>
							<div className="flex items-start gap-2.5 text-xs leading-5 text-black/60 dark:text-white/60">
								<HugeiconsIcon icon={AlertCircleIcon} aria-hidden className="mt-0.5 shrink-0" size={14} />
								<p>
									Once reserved, this DOI stays assigned to this record. The DOI appears immediately while Crossref checks the publication.
								</p>
							</div>
						</ModalBody>
						<ModalFooter className="gap-2 px-4 pb-4 pt-2">
							<Button isDisabled={busy} onPress={onClose} size="xs" variant="transparent">
								Cancel
							</Button>
							<Button
								color="accent"
								isDisabled={busy}
								isLoading={busy}
								onPress={() => {
									void onConfirm().then((succeeded) => {
										if (succeeded) onClose();
									});
								}}
								size="xs"
								variant="solid"
							>
								Activate DOI
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}

export function AdminZenodoActivation({
	busy,
	error,
	fieldErrors,
	isOpen,
	onConfirm,
	onOpenChange,
	onPolicyChange,
	policy,
	publication,
}: {
	busy: boolean;
	error: string | null;
	fieldErrors: AdminFieldErrors;
	isOpen: boolean;
	onConfirm: () => Promise<boolean>;
	onOpenChange: (open: boolean) => void;
	onPolicyChange: (policy: ZenodoIdentifierPolicy) => void;
	policy: ZenodoIdentifierPolicy;
	publication: AdminPublicationView;
}) {
	const allowed = new Set(
		publication.providers.zenodo.capabilities.allowedIdentifierPolicies,
	);
	return (
		<DialogModal
			isOpen={isOpen}
			onOpenChange={onOpenChange}
			size="sm"
		>
			<ModalContent>
				{(onClose) => (
					<>
						<ModalHeader className="px-4 pb-2 pt-4 text-base font-semibold">
							Publish to Zenodo
						</ModalHeader>
						<ModalBody className="gap-3 px-4 py-2">
							<ActivationError error={error} fieldErrors={fieldErrors} />
							<p className="text-xs leading-5 text-black/55 dark:text-white/55">
								Choose which DOI this Zenodo publication will use. This choice cannot change after the first publication.
							</p>
							<RadioGroup
								aria-label="Zenodo DOI choice"
								classNames={{ wrapper: "gap-2" }}
								value={policy}
								onValueChange={(value) =>
									onPolicyChange(
										value as ZenodoIdentifierPolicy,
									)
								}
							>
								{allowed.has("reuse-external") ? (
									<Radio
										classNames={{
											base: "m-0 max-w-none items-start rounded-xl bg-black/[0.035] p-3 data-[selected=true]:bg-accent/[0.08] dark:bg-white/[0.045] dark:data-[selected=true]:bg-accent/[0.12]",
											label: "w-full",
										}}
										value="reuse-external"
									>
										<span className="block text-sm font-semibold text-black/80 dark:text-white/85">
											Use the record&apos;s existing DOI
										</span>
										<span className="mt-0.5 block text-xs leading-5 text-black/50 dark:text-white/50">
											{publication.identifiers.doi?.value ?? "The record's DOI"} stays the DOI. Nothing is registered; Zenodo keeps a copy of the record and PDF.
										</span>
									</Radio>
								) : null}
								<Radio
									classNames={{
										base: "m-0 max-w-none items-start rounded-xl bg-black/[0.035] p-3 data-[selected=true]:bg-accent/[0.08] dark:bg-white/[0.045] dark:data-[selected=true]:bg-accent/[0.12]",
										label: "w-full",
									}}
									isDisabled={!allowed.has("reuse-crossref")}
									value="reuse-crossref"
								>
									<span className="block text-sm font-semibold text-black/80 dark:text-white/85">
										Use the Crossref DOI
									</span>
									<span className="mt-0.5 block text-xs leading-5 text-black/50 dark:text-white/50">
										{allowed.has("reuse-crossref")
											? "Recommended. Zenodo uses the same DOI."
											: "Activate Crossref first to use the same DOI."}
									</span>
								</Radio>
								<Radio
									classNames={{
										base: "m-0 max-w-none items-start rounded-xl bg-black/[0.035] p-3 data-[selected=true]:bg-accent/[0.08] dark:bg-white/[0.045] dark:data-[selected=true]:bg-accent/[0.12]",
										label: "w-full",
									}}
									isDisabled={!allowed.has("mint-zenodo")}
									value="mint-zenodo"
								>
									<span className="block text-sm font-semibold text-black/80 dark:text-white/85">
										Create a Zenodo DOI too
									</span>
									<span className="mt-0.5 block text-xs leading-5 text-black/50 dark:text-white/50">
										Zenodo creates a version DOI and a concept DOI.
									</span>
								</Radio>
							</RadioGroup>
							<div className="flex items-start gap-2.5 text-xs leading-5 text-black/50 dark:text-white/50">
								<HugeiconsIcon icon={DatabaseIcon} aria-hidden className="mt-0.5 shrink-0" size={14} />
								<p>The published record and PDF will be stored in Zenodo.</p>
							</div>
						</ModalBody>
						<ModalFooter className="gap-2 px-4 pb-4 pt-2">
							<Button isDisabled={busy} onPress={onClose} size="xs" variant="transparent">
								Cancel
							</Button>
							<Button
								color="accent"
								isDisabled={busy || !allowed.has(policy)}
								isLoading={busy}
								onPress={() => {
									void onConfirm().then((succeeded) => {
										if (succeeded) onClose();
									});
								}}
								size="xs"
								variant="solid"
							>
								Publish to Zenodo
							</Button>
						</ModalFooter>
					</>
				)}
			</ModalContent>
		</DialogModal>
	);
}
