"use client";

import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { DropdownItem, DropdownMenu, DropdownSection, DropdownTrigger, ModalBody, ModalContent } from "@nextui-org/react";
import {
	Alert02Icon,
	ArrowDown01Icon,
	CrownIcon,
	Delete02Icon,
	Mail01Icon,
	PencilEdit01Icon,
	RefreshIcon,
	Tick02Icon,
	UserRemove01Icon,
	ViewIcon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import DialogModal from "@/components/nextui/DialogModal";
import { Dropdown } from "@/components/nextui/Dropdown";
import { Input } from "@/components/nextui/Input";
import GenericHeader from "@/components/features/modals/GenericHeader";
import { toast } from "@/components/layout/Toast";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import { useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { useReaderData } from "@/hooks/useReaderData";
import { fetcher } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import type { ReaderCollectionRole } from "@/db/schema/tables/reader";
import type { PendingCollectionInvitation } from "@/lib/readers/collection-invitations";
import type { CollectionMember, ReaderCollectionSummary, ReaderPerson } from "@/lib/readers/data";

type Role = ReaderCollectionRole | "owner";

/** One icon per role, the same wherever a role shows. */
const ROLE_ICONS = { owner: CrownIcon, editor: PencilEdit01Icon, viewer: ViewIcon } as const;

function useRoleLabel() {
	const t = useTranslations("ui");
	return (role: Role) => (role === "owner" ? t("roleOwner") : role === "editor" ? t("roleEditor") : t("roleViewer"));
}

/** What someone may do with a collection, as an icon and its name. */
export function RoleChip({ role, className }: { role: Role; className?: string }) {
	const label = useRoleLabel();
	return (
		<span className={twMerge("inline-flex shrink-0 items-center gap-1.5 text-small font-medium text-black/70 dark:text-white/70", className)}>
			<HugeiconsIcon icon={ROLE_ICONS[role]} className="size-4 shrink-0" aria-hidden />
			{label(role)}
		</span>
	);
}

const SENT_INVITATIONS = "/reader/invitations";

/** The invitations the signed-in reader sent that still wait, read once for their whole profile so the Share dialog opens with them. */
export function useSentInvitations(enabled: boolean) {
	return useSWR<{ invitations: PendingCollectionInvitation[] }>(enabled ? SENT_INVITATIONS : null, fetcher, { revalidateOnFocus: false });
}

async function send(path: string, method: "POST" | "PATCH" | "DELETE", body?: object) {
	const response = await fetch(`/api${path}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) {
		const answer = (await response.json().catch(() => null)) as { error?: string } | null;
		throw new Error(answer?.error ?? `HTTP ${response.status}`);
	}
	return response.status === 204 ? null : ((await response.json()) as unknown);
}

/**
 * The faces of the people a collection is shared with, for its owner and its
 * members, overlapping like a stack. Past three, a count stands for the rest.
 */
export function MemberFaces({ members, className }: { members: ReaderPerson[]; className?: string }) {
	const t = useTranslations("ui");
	if (members.length === 0) return null;
	const shown = members.slice(0, 3);
	return (
		<span role="img" className={twMerge("flex items-center -space-x-1.5 rtl:space-x-reverse", className)} aria-label={t("collectionPeopleCount", { count: members.length })}>
			{shown.map((member) => (
				<ReaderAvatar key={member.id} reader={member} size="sm" className="h-6 w-6 text-[10px] ring-2 ring-white dark:ring-secondary [&_svg]:size-3.5" aria-hidden />
			))}
			{members.length > shown.length ? (
				<span aria-hidden className="relative flex h-6 min-w-6 items-center justify-center rounded-full bg-black/[0.06] px-1.5 text-[11px] font-semibold tabular-nums text-black/70 ring-2 ring-white dark:bg-white/10 dark:text-white/70 dark:ring-secondary">
					+{members.length - shown.length}
				</span>
			) : null}
		</span>
	);
}

/** The two roles as a menu's items, each with what it allows and the chosen one ticked. */
function useRoleItems() {
	const t = useTranslations("ui");
	const roleLabel = useRoleLabel();
	return (chosen: ReaderCollectionRole, onPick: (role: ReaderCollectionRole) => void) =>
		(["editor", "viewer"] as const).map((option) => (
			<DropdownItem
				key={option}
				onPress={() => option !== chosen && onPick(option)}
				startContent={<HugeiconsIcon icon={ROLE_ICONS[option]} className="size-5 shrink-0" aria-hidden />}
				endContent={option === chosen ? <HugeiconsIcon icon={Tick02Icon} className="size-4 shrink-0 text-accent" aria-hidden /> : null}
				description={option === "editor" ? t("roleEditorDescription") : t("roleViewerDescription")}
			>
				{roleLabel(option)}
			</DropdownItem>
		));
}

/**
 * The role menu every row of the Share dialog has: the two roles, then what
 * else can be done with that person or invitation.
 */
function RoleMenu({
	role,
	label,
	onRole,
	actions,
	isDisabled,
}: {
	role: ReaderCollectionRole;
	label: string;
	onRole: (role: ReaderCollectionRole) => void;
	actions: { key: string; label: string; icon: typeof Delete02Icon; danger?: boolean; onPress: () => void }[];
	isDisabled?: boolean;
}) {
	const roleLabel = useRoleLabel();
	const roleItems = useRoleItems();
	return (
		<Dropdown placement="bottom-end" isDisabled={isDisabled}>
			<DropdownTrigger>
				<Button
					variant="transparent"
					aria-label={label}
					startContent={<HugeiconsIcon icon={ROLE_ICONS[role]} className="size-4 shrink-0" aria-hidden />}
					endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="ms-auto size-4 opacity-60" aria-hidden />}
					className="h-9 w-32 min-w-0 shrink-0 justify-start gap-1.5 px-3 text-small font-medium"
				>
					{roleLabel(role)}
				</Button>
			</DropdownTrigger>
			<DropdownMenu aria-label={label} className="w-64">
				<DropdownSection showDivider={actions.length > 0}>{roleItems(role, onRole)}</DropdownSection>
				<DropdownSection>
					{actions.map((action) => (
						<DropdownItem
							key={action.key}
							onPress={action.onPress}
							startContent={<HugeiconsIcon icon={action.icon} className="size-5 shrink-0" aria-hidden />}
							className={action.danger ? "text-danger dark:text-danger" : undefined}
						>
							{action.label}
						</DropdownItem>
					))}
				</DropdownSection>
			</DropdownMenu>
		</Dropdown>
	);
}

/**
 * One person or invitation in the Share dialog: who, a line about them, and
 * what they may do. A row that arrives after the dialog opened slides open,
 * and one being removed closes before it goes, so the rows below move with it.
 */
function PersonRow({
	face,
	name,
	line,
	end,
	entering = false,
	leaving = false,
}: {
	face: ReactNode;
	name: ReactNode;
	line?: ReactNode;
	end: ReactNode;
	entering?: boolean;
	leaving?: boolean;
}) {
	// Opening plays on the row and closing on the grid inside it, so no box both animates and transitions.
	return (
		<li inert={leaving || undefined} className={twMerge("grid grid-rows-[1fr] motion-reduce:animate-none", entering && "animate-row-open")}>
			<div
				className={twMerge(
					"grid min-h-0 transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none",
					leaving ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr]",
				)}
			>
				<div className="min-h-0 overflow-hidden">
					<div className="flex items-center gap-3 py-2">
						{face}
						<span className="flex min-w-0 flex-1 flex-col">
							<span className="truncate font-medium text-black/85 dark:text-white/85">{name}</span>
							{line ? <span className="flex min-w-0 items-center gap-1 text-small text-black/50 dark:text-white/50">{line}</span> : null}
						</span>
						{end}
					</div>
				</div>
			</div>
		</li>
	);
}

/** How long a removed row takes to close, as its transition above. */
const ROW_CLOSE_MS = 200;

/**
 * Who a collection is shared with, for its owner: an address and a role to
 * invite someone, then the owner, the members and the invitations still
 * waiting. Every change applies at once. OpenScholar sends the invitations
 * and keeps them until they are answered; the members are the library's.
 */
export function ShareCollectionDialog({
	collection,
	invitations,
	onClose,
}: {
	collection: ReaderCollectionSummary;
	invitations: PendingCollectionInvitation[] | undefined;
	onClose: () => void;
}) {
	const t = useTranslations("ui");
	return (
		// On wider screens it hangs from a fixed top, so a person added or removed grows or shrinks it downward and nothing above moves.
		<DialogModal size="lg" classNames={{ wrapper: "sm:items-start", base: "sm:mt-[12vh]" }} isOpen onOpenChange={(open) => !open && onClose()}>
			<ModalContent>
				<GenericHeader onClose={onClose}>{t("shareCollectionTitle", { name: collection.name })}</GenericHeader>
				<SharePanel collection={collection} invitations={invitations} />
			</ModalContent>
		</DialogModal>
	);
}

function SharePanel({ collection, invitations }: { collection: ReaderCollectionSummary; invitations: PendingCollectionInvitation[] | undefined }) {
	const t = useTranslations("ui");
	const format = useFormatter();
	const { reader } = useReaderSession();
	const { refresh } = useReaderData();
	const { mutate } = useSentInvitations(true);
	const waiting = (invitations ?? []).filter((invitation) => invitation.collectionId === collection.id);
	// The rows there when the dialog opened; any other row arrived since, and slides open.
	const [opened] = useState(() => new Set([...collection.members.map((member) => member.id), ...waiting.map((invitation) => invitation.id)]));
	const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
	const markLeaving = (id: string, on: boolean) =>
		setLeaving((current) => {
			const next = new Set(current);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});
	// A refusal shows as a toast, so nothing in the dialog moves. A removal closes its row first.
	const change = async (run: () => Promise<unknown>, after: () => Promise<unknown>, removing?: string) => {
		if (removing) {
			markLeaving(removing, true);
			await new Promise((resolve) => setTimeout(resolve, ROW_CLOSE_MS));
		}
		try {
			await run();
		} catch (error) {
			if (removing) markLeaving(removing, false);
			toast({ type: "error", title: t("sharingFailed"), description: error instanceof Error ? error.message : undefined });
			return;
		}
		// The change is made: a list that fails to reload keeps its row closed, and shows the change on its next read.
		await after().catch((error: unknown) => console.error("Reloading who a collection is shared with failed", error));
	};
	const people = `/reader/collections/${collection.id}/members`;
	const changeMember = (member: CollectionMember, role: ReaderCollectionRole | null) =>
		role
			? change(() => send(`${people}/${member.id}`, "PATCH", { role }), refresh)
			: change(() => send(`${people}/${member.id}`, "DELETE"), refresh, member.id);
	const changeInvitation = (invitation: PendingCollectionInvitation, body: object | null) =>
		body
			? change(() => send(`/reader/invitations/${invitation.id}`, "PATCH", body), () => mutate())
			: change(() => send(`/reader/invitations/${invitation.id}`, "DELETE"), () => mutate(), invitation.id);

	return (
		<ModalBody className="gap-5 px-6 pb-6 pt-0">
			<InviteForm collectionId={collection.id} onInvited={() => mutate()} />
			<ul className="-my-2 flex max-h-[min(26rem,55vh)] flex-col overflow-y-auto">
				{reader ? (
					<PersonRow
						face={<ReaderAvatar reader={reader} size="md" />}
						name={
							<>
								{readerDisplayName(reader, t)} <span className="font-normal text-black/50 dark:text-white/50">{t("youTag")}</span>
							</>
						}
						end={<RoleChip role="owner" className="w-32 justify-start px-3" />}
					/>
				) : null}
				{collection.members.map((member) => (
					<PersonRow
						key={member.id}
						entering={!opened.has(member.id)}
						leaving={leaving.has(member.id)}
						face={<ReaderAvatar reader={member} size="md" />}
						name={readerDisplayName(member, t)}
						end={
							<RoleMenu
								role={member.role}
								label={t("accessOf", { name: readerDisplayName(member, t) })}
								onRole={(role) => void changeMember(member, role)}
								actions={[{ key: "remove", label: t("removeFromCollection"), icon: UserRemove01Icon, danger: true, onPress: () => void changeMember(member, null) }]}
							/>
						}
					/>
				))}
				{waiting.map((invitation) => (
					<PersonRow
						key={invitation.id}
						entering={!opened.has(invitation.id)}
						leaving={leaving.has(invitation.id)}
						face={
							<span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
								<HugeiconsIcon icon={Mail01Icon} className="size-5" aria-hidden />
							</span>
						}
						name={invitation.email}
						line={
							invitation.delivery === "failed" ? (
								<span className="flex items-center gap-1 text-danger">
									<HugeiconsIcon icon={Alert02Icon} className="size-3.5 shrink-0" aria-hidden />
									{t("invitationNotSent")}
								</span>
							) : (
								t("invitedWhen", { when: format.relativeTime(new Date(invitation.sentAt)) })
							)
						}
						end={
							<RoleMenu
								role={invitation.role}
								label={t("accessOf", { name: invitation.email })}
								onRole={(role) => void changeInvitation(invitation, { role })}
								actions={[
									{ key: "resend", label: t("resendInvitation"), icon: RefreshIcon, onPress: () => void changeInvitation(invitation, { resend: true, collectionId: collection.id }) },
									{ key: "cancel", label: t("cancelInvitation"), icon: Delete02Icon, danger: true, onPress: () => void changeInvitation(invitation, null) },
								]}
							/>
						}
					/>
				))}
			</ul>
		</ModalBody>
	);
}

/** An address and the role it gets, then Invite. A new invitation joins the list below. */
function InviteForm({ collectionId, onInvited }: { collectionId: string; onInvited: () => Promise<unknown> }) {
	const t = useTranslations("ui");
	const roleLabel = useRoleLabel();
	const roleItems = useRoleItems();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<ReaderCollectionRole>("editor");
	const [sending, setSending] = useState(false);
	const address = email.trim();
	return (
		<form
			className="flex flex-col"
			onSubmit={(event) => {
				event.preventDefault();
				if (!address || sending) return;
				setSending(true);
				void send(`/reader/collections/${collectionId}/invitations`, "POST", { email: address, role })
					.then(async () => {
						await onInvited();
						setEmail("");
					})
					.catch((error: unknown) =>
						toast({ type: "error", title: t("invitationNotSentTitle"), description: error instanceof Error ? error.message : undefined }),
					)
					.finally(() => setSending(false));
			}}
		>
			<div className="flex flex-wrap gap-2 sm:flex-nowrap">
				<Input
					type="email"
					autoFocus
					aria-label={t("addPeopleByEmail")}
					placeholder={t("addPeopleByEmail")}
					value={email}
					onValueChange={setEmail}
					startContent={<HugeiconsIcon icon={Mail01Icon} className="size-5 shrink-0 text-black/40 dark:text-white/40" aria-hidden />}
					endContent={
						<Dropdown placement="bottom-end">
							<DropdownTrigger>
								<Button
									variant="transparent"
									aria-label={t("inviteAs", { role: roleLabel(role) })}
									endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="size-4 opacity-60" aria-hidden />}
									className="-me-2 h-8 min-w-0 shrink-0 gap-1.5 px-2.5 text-small font-medium"
								>
									{roleLabel(role)}
								</Button>
							</DropdownTrigger>
							<DropdownMenu aria-label={t("inviteAs", { role: roleLabel(role) })} className="w-64">
								{roleItems(role, setRole)}
							</DropdownMenu>
						</Dropdown>
					}
					classNames={{ base: "flex-1" }}
				/>
				<Button type="submit" color="accent" isDisabled={!address} isLoading={sending} className="h-11 shrink-0 px-5 font-medium max-sm:w-full sm:h-auto sm:self-stretch">
					{t("inviteAction")}
				</Button>
			</div>
		</form>
	);
}
