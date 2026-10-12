"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { z } from "zod";
import {
	Alert02Icon,
	ArrowUpRight01Icon,
	BookBookmark01Icon,
	CollectionsBookmarkIcon,
	Link01Icon,
	Login01Icon,
	Mail01Icon,
	SquareLock01Icon,
} from "@hugeicons/core-free-icons";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import { Skeleton } from "@/components/nextui/Skeleton";
import PageContainer from "@/components/layout/PageContainer";
import { ReaderAvatar, readerDisplayName } from "@/components/layout/navbar/UserMenu";
import { useOpenScholarAccountUrl, useReaderSession } from "@/components/layout/navbar/ReaderSession";
import { RoleChip } from "@/components/features/collections/CollectionPeople";
import { Link, useRouter } from "@/i18n/routing";
import type { ReaderCollectionRole } from "@/db/schema/tables/reader";
import type { ReaderPerson } from "@/lib/readers/data";

export type InvitationView =
	| { state: "signedOut" }
	| { state: "gone" }
	| { state: "other" }
	| { state: "unavailable" }
	| {
			state: "pending" | "accepted";
			role: ReaderCollectionRole;
			collection: { id: string; name: string; description: string | null; private: boolean; count: number; owner: ReaderPerson };
	  };

/** The card every state of the page is: a band in the library's colour, what sits on it, the words, then what to do. */
function Landing({
	hero,
	chips,
	children,
	...words
}: {
	hero: ReactNode;
	chips?: ReactNode;
	children: ReactNode;
} & LandingWordsProps) {
	return (
		<PageContainer id="main-content" className="flex justify-center">
			<section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-secondary">
				<div aria-hidden className="h-28 bg-accent/10 sm:h-32" />
				<div className="flex flex-col items-center gap-5 px-6 pb-8 text-center sm:px-10 sm:pb-10">
					<span className="-mt-14 rounded-full bg-white p-1.5 dark:bg-secondary">{hero}</span>
					<LandingWords {...words} />
					{chips ? <div className="flex flex-wrap justify-center gap-2">{chips}</div> : null}
					<div className="flex w-full flex-col gap-2">{children}</div>
				</div>
			</section>
		</PageContainer>
	);
}

type LandingWordsProps = {
	lead?: ReactNode;
	/** Null while the invitation is not read yet: a placeholder the title's line height. */
	title: string | null;
	detail?: ReactNode;
	/** Why opening failed, in place of the line under the title, so nothing moves. */
	failed?: string | null;
};

function LandingWords({ lead, title, detail, failed }: LandingWordsProps) {
	const line = failed ? (
		<p role="alert" className="max-w-sm text-danger">
			{failed}
		</p>
	) : detail ? (
		// A placeholder can't know whether the invitation's collection has a description, or how long it is, so it
		// opens to its height. The gap above it is inside what opens, so nothing moves by the gap when it arrives.
		<div className="-mt-3 grid grid-rows-[1fr] animate-row-open motion-reduce:animate-none">
			<p className="min-h-0 max-w-sm overflow-hidden pt-3 text-black/60 dark:text-white/60">{detail}</p>
		</div>
	) : null;
	return (
		<div className="flex flex-col items-center gap-3">
			{lead}
			{title === null ? (
				<Skeleton className="h-9 w-56 max-w-full rounded-xl" />
			) : (
				<h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] dark:text-white">{title}</h1>
			)}
			{line}
		</div>
	);
}

function IconHero({ icon, tone = "accent" }: { icon: typeof Mail01Icon; tone?: "accent" | "danger" }) {
	return (
		<span className={tone === "danger" ? "flex size-24 items-center justify-center rounded-full bg-danger/10 text-danger" : "flex size-24 items-center justify-center rounded-full bg-accent/10 text-accent"}>
			<HugeiconsIcon icon={icon} className="size-10" aria-hidden />
		</span>
	);
}

/**
 * The page before the server has read the invitation. Signed out, it is the
 * same page whatever the invitation is. Signed in, it is a placeholder the
 * size of the most common answer, an invitation still to open.
 */
export function CollectionInvitationPlaceholder({ invitationId }: { invitationId: string }) {
	const { reader } = useReaderSession();
	if (!reader) return <CollectionInvitation invitationId={invitationId} view={{ state: "signedOut" }} />;
	return (
		<Landing
			hero={<Skeleton className="size-24 rounded-full" />}
			lead={<Skeleton className="h-5 w-40 rounded-lg" />}
			title={null}
			chips={
				<>
					<Skeleton className="h-8 w-24 rounded-full" />
					<Skeleton className="h-8 w-28 rounded-full" />
				</>
			}
		>
			<Skeleton className="h-12 rounded-2xl" />
		</Landing>
	);
}

function Chip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-small font-medium text-black/70 dark:bg-white/10 dark:text-white/70">
			{children}
		</span>
	);
}

type OpenedCollection = { ownerId: string; collectionId: string };
const openedSchema = z.object({ ownerId: z.string().min(1), collectionId: z.string().min(1) });

/** Accepts the invitation and answers where its collection is, or throws why it couldn't: the library's reason, else `failedMessage`. */
async function acceptInvitation(invitationId: string, failedMessage: string): Promise<OpenedCollection> {
	const response = await fetch(`/api/reader/invitations/${invitationId}/accept`, { method: "POST" });
	const answer: unknown = await response.json().catch(() => null);
	const opened = openedSchema.safeParse(answer);
	if (response.ok && opened.success) return opened.data;
	throw new Error(z.object({ error: z.string() }).catch({ error: failedMessage }).parse(answer).error);
}

/**
 * Accepts the invitation and opens the collection on its owner's profile. One accepted already goes through
 * accepting too: that finishes an acceptance the library failed to record, and refuses access the owner ended since.
 */
function useOpen(invitationId: string) {
	const router = useRouter();
	const t = useTranslations("ui");
	const [opening, setOpening] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const open = async () => {
		setOpening(true);
		setFailed(null);
		try {
			const target = await acceptInvitation(invitationId, t("invitationOpenFailed"));
			router.push(`/profile/${target.ownerId}?collectionId=${target.collectionId}`);
		} catch (error) {
			setOpening(false);
			setFailed(error instanceof Error ? error.message : t("invitationOpenFailed"));
		}
	};
	return { open, opening, failed };
}

/**
 * The page an invitation email links to. Signed out, it asks for the
 * OpenScholar account the invitation was sent to. Signed in with it, it shows
 * the collection, who shared it and what the reader may do, and Open makes
 * them a member and opens it. Another account is told only that the
 * invitation went to another address.
 */
export default function CollectionInvitation({ invitationId, view }: { invitationId: string; view: InvitationView }) {
	if (view.state === "pending" || view.state === "accepted") return <InvitationToOpen invitationId={invitationId} view={view} />;
	if (view.state === "other") return <SentElsewhere invitationId={invitationId} />;
	return <NothingToOpen state={view.state} />;
}

/** Signed out, an invitation that's gone, or OpenScholar out of reach: what the reader can do next. */
function NothingToOpen({ state }: { state: "signedOut" | "gone" | "unavailable" }) {
	const t = useTranslations("ui");
	const router = useRouter();
	const { signIn } = useReaderSession();
	if (state === "signedOut") {
		return (
			<Landing hero={<IconHero icon={Mail01Icon} />} title={t("invitationSignInTitle")} detail={t("invitationSignInDetail")}>
				<Button color="accent" onPress={signIn} startContent={<HugeiconsIcon icon={Login01Icon} className="size-5" aria-hidden />} className="h-12 font-medium">
					{t("signIn")}
				</Button>
			</Landing>
		);
	}
	if (state === "gone") {
		return (
			<Landing hero={<IconHero icon={Link01Icon} />} title={t("invitationGoneTitle")} detail={t("invitationGoneDetail")}>
				<Button as={Link} href="/" className="h-12 font-medium">
					{t("invitationGoToLibrary")}
				</Button>
			</Landing>
		);
	}
	return (
		<Landing hero={<IconHero icon={Alert02Icon} tone="danger" />} title={t("invitationUnavailableTitle")} detail={t("invitationUnavailableDetail")}>
			<Button color="accent" onPress={() => router.refresh()} className="h-12 font-medium">
				{t("tryAgain")}
			</Button>
		</Landing>
	);
}

/** An account without the invited address: it learns nothing of the collection, and can still open it if Clerk has that address on it too. */
function SentElsewhere({ invitationId }: { invitationId: string }) {
	const t = useTranslations("ui");
	const accountUrl = useOpenScholarAccountUrl();
	const { open, opening, failed } = useOpen(invitationId);
	return (
		<Landing hero={<IconHero icon={Mail01Icon} />} title={t("invitationOtherTitle")} detail={t("invitationOtherDetail")} failed={failed}>
			<Button color="accent" onPress={() => void open()} isLoading={opening} className="h-12 font-medium">
				{t("invitationOpen")}
			</Button>
			<Button
				as="a"
				href={accountUrl}
				target="_blank"
				rel="noopener"
				variant="transparent"
				endContent={<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4 opacity-60" aria-hidden />}
				className="h-12 font-medium"
			>
				{t("invitationAddAddress")}
			</Button>
		</Landing>
	);
}

/** The collection, who shared it and what the reader may do, then Open. */
function InvitationToOpen({ invitationId, view }: { invitationId: string; view: Extract<InvitationView, { collection: unknown }> }) {
	const t = useTranslations("ui");
	const { collection } = view;
	const { open, opening, failed } = useOpen(invitationId);
	return (
		<Landing
			hero={
				<span className="relative block">
					<ReaderAvatar reader={collection.owner} size="lg" className="h-24 w-24 text-3xl [&_svg]:size-10" />
					<span className="absolute -bottom-1 -end-1 flex size-9 items-center justify-center rounded-full bg-accent text-white ring-4 ring-white dark:ring-secondary">
						<HugeiconsIcon icon={CollectionsBookmarkIcon} className="size-5" aria-hidden />
					</span>
				</span>
			}
			lead={<span className="text-small font-medium text-black/60 dark:text-white/60">{t("invitationSharedBy", { name: readerDisplayName(collection.owner, t) })}</span>}
			title={collection.name}
			detail={collection.description}
			failed={failed}
			chips={
				<>
					<Chip>
						<RoleChip role={view.role} className="text-inherit" />
					</Chip>
					<Chip>
						<HugeiconsIcon icon={BookBookmark01Icon} className="size-4 shrink-0" aria-hidden />
						<span className="tabular-nums">{t("collectionRecordCount", { count: collection.count })}</span>
					</Chip>
					{collection.private ? (
						<Chip>
							<HugeiconsIcon icon={SquareLock01Icon} className="size-4 shrink-0" aria-hidden />
							{t("privateCollection")}
						</Chip>
					) : null}
				</>
			}
		>
			<Button color="accent" onPress={() => void open()} isLoading={opening} className="h-12 font-medium">
				{t("invitationOpen")}
			</Button>
		</Landing>
	);
}
