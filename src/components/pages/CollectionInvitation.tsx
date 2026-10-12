"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
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
	lead,
	title,
	detail,
	failed,
	chips,
	children,
}: {
	hero: ReactNode;
	lead?: ReactNode;
	title: string;
	detail?: ReactNode;
	/** Why opening failed, in place of the line under the title, so nothing moves. */
	failed?: string | null;
	chips?: ReactNode;
	children: ReactNode;
}) {
	return (
		<PageContainer id="main-content" className="flex justify-center">
			<section className="w-full max-w-lg overflow-hidden rounded-2xl bg-white dark:bg-secondary">
				<div aria-hidden className="h-28 bg-accent/10 sm:h-32" />
				<div className="flex flex-col items-center gap-5 px-6 pb-8 text-center sm:px-10 sm:pb-10">
					<span className="-mt-14 rounded-full bg-white p-1.5 dark:bg-secondary">{hero}</span>
					<div className="flex flex-col items-center gap-3">
						{lead}
						<h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] dark:text-white">{title}</h1>
						{failed ? (
							<p role="alert" className="max-w-sm text-danger">
								{failed}
							</p>
						) : detail ? (
							<p className="max-w-sm text-black/60 dark:text-white/60">{detail}</p>
						) : null}
					</div>
					{chips ? <div className="flex flex-wrap justify-center gap-2">{chips}</div> : null}
					<div className="flex w-full flex-col gap-2">{children}</div>
				</div>
			</section>
		</PageContainer>
	);
}

function IconHero({ icon, tone = "accent" }: { icon: typeof Mail01Icon; tone?: "accent" | "danger" }) {
	return (
		<span className={tone === "danger" ? "flex size-24 items-center justify-center rounded-full bg-danger/10 text-danger" : "flex size-24 items-center justify-center rounded-full bg-accent/10 text-accent"}>
			<HugeiconsIcon icon={icon} className="size-10" aria-hidden />
		</span>
	);
}

function Chip({ children }: { children: ReactNode }) {
	return (
		<span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/[0.05] px-3 text-small font-medium text-black/70 dark:bg-white/10 dark:text-white/70">
			{children}
		</span>
	);
}

/** Accepts the invitation and opens the collection on its owner's profile. */
function useOpen(invitationId: string, opened?: { ownerId: string; collectionId: string }) {
	const router = useRouter();
	const t = useTranslations("ui");
	const [opening, setOpening] = useState(false);
	const [failed, setFailed] = useState<string | null>(null);
	const open = async () => {
		setOpening(true);
		setFailed(null);
		try {
			let target = opened;
			if (!target) {
				const response = await fetch(`/api/reader/invitations/${invitationId}/accept`, { method: "POST" });
				const answer = (await response.json().catch(() => null)) as { error?: string; collectionId?: string; ownerId?: string } | null;
				if (!response.ok || !answer?.collectionId || !answer.ownerId) throw new Error(answer?.error ?? t("invitationOpenFailed"));
				target = { ownerId: answer.ownerId, collectionId: answer.collectionId };
			}
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
	const t = useTranslations("ui");
	const router = useRouter();
	const { signIn } = useReaderSession();
	const accountUrl = useOpenScholarAccountUrl();
	const { open, opening, failed } = useOpen(
		invitationId,
		view.state === "accepted" ? { ownerId: view.collection.owner.id, collectionId: view.collection.id } : undefined,
	);

	if (view.state === "signedOut") {
		return (
			<Landing hero={<IconHero icon={Mail01Icon} />} title={t("invitationSignInTitle")} detail={t("invitationSignInDetail")}>
				<Button color="accent" onPress={signIn} startContent={<HugeiconsIcon icon={Login01Icon} className="size-5" aria-hidden />} className="h-12 font-medium">
					{t("signIn")}
				</Button>
			</Landing>
		);
	}
	if (view.state === "gone") {
		return (
			<Landing hero={<IconHero icon={Link01Icon} />} title={t("invitationGoneTitle")} detail={t("invitationGoneDetail")}>
				<Button as={Link} href="/" className="h-12 font-medium">
					{t("invitationGoToLibrary")}
				</Button>
			</Landing>
		);
	}
	if (view.state === "unavailable") {
		return (
			<Landing hero={<IconHero icon={Alert02Icon} tone="danger" />} title={t("invitationUnavailableTitle")} detail={t("invitationUnavailableDetail")}>
				<Button color="accent" onPress={() => router.refresh()} className="h-12 font-medium">
					{t("tryAgain")}
				</Button>
			</Landing>
		);
	}
	if (view.state === "other") {
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

	const { collection } = view;
	const owner = readerDisplayName(collection.owner, t);
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
			lead={<span className="text-small font-medium text-black/60 dark:text-white/60">{t("invitationSharedBy", { name: owner })}</span>}
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
