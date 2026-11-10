"use client";

import Link from "next/link";
import { useState } from "react";
import { Tabs, Tab } from "@nextui-org/react";
import {
	Calendar03Icon,
	Mail01Icon,
	UserAdd01Icon,
	BookOpen01Icon,
	ComputerIcon,
	SmartPhone01Icon,
	Message01Icon,
	Flag01Icon,
	CheckmarkCircle02Icon,
	InboxIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Button } from "@/components/nextui/Button";
import PageContainer from "@/components/layout/PageContainer";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

type Edition = { id: string; label: string; subject: string; html: string };
const icons: Record<string, typeof Calendar03Icon> = {
	digest: Calendar03Icon,
	items: BookOpen01Icon,
	invitation: UserAdd01Icon,
	confirm: Mail01Icon,
	contact: Message01Icon,
	takedown: Flag01Icon,
	"suggestion-live": CheckmarkCircle02Icon,
	"suggestion-declined": InboxIcon,
};
export default function EmailPreviews({
	editions,
	senderEmail,
}: {
	editions: Edition[];
	senderEmail: string;
}) {
	const [kind, setKind] = useState("digest"),
		[mobile, setMobile] = useState(false);
	const config = useLibraryConfig();
	const edition = editions.find((e) => e.id === kind)!;
	return (
		<PageContainer className="mx-auto">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Email previews</h1>
					<p className="mt-1 text-sm text-black/50 dark:text-white/50">
						Sample content for design review. No emails are sent.
					</p>
				</div>
				<Button as={Link} href="/lib/RHSRAM6J" size="md">
					Author hover preview
				</Button>
			</div>
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<Tabs
					aria-label="Email type"
					selectedKey={kind}
					onSelectionChange={(key) => setKind(String(key))}
					variant="light"
					classNames={{
						tabList:
							"gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/5",
						cursor: "rounded-lg bg-card_light shadow-sm dark:bg-card",
						tab: "h-10 px-3",
						tabContent: "text-sm",
					}}
				>
					{editions.map((e) => (
						<Tab
							key={e.id}
							title={
								<span className="flex items-center gap-2">
									<HugeiconsIcon
										icon={icons[e.id]!}
										size={17}
									/>
									{e.label}
								</span>
							}
						/>
					))}
				</Tabs>
				<div className="flex rounded-xl bg-black/5 p-1 dark:bg-white/5">
					{[false, true].map((m) => (
						<Button
							key={String(m)}
							size="md"
							isIconOnly
							aria-label={m ? "Mobile email" : "Desktop email"}
							onPress={() => setMobile(m)}
							className={
								mobile === m
									? "bg-card_light dark:bg-card"
									: "border-transparent bg-transparent dark:bg-transparent"
							}
						>
							<HugeiconsIcon
								icon={m ? SmartPhone01Icon : ComputerIcon}
								size={18}
							/>
						</Button>
					))}
				</div>
			</div>
			<div
				className="mx-auto overflow-hidden rounded-2xl border border-black/10 bg-card_light dark:border-white/10 dark:bg-card"
				style={{ maxWidth: mobile ? 390 : 900 }}
			>
				<div className="space-y-1 border-b border-black/10 px-5 py-4 text-sm dark:border-white/10">
					<div className="flex gap-3">
						<span className="w-12 shrink-0 text-black/45 dark:text-white/45">
							From
						</span>
						<span className="font-medium">
							{config.identity.name}{" "}
							<span className="break-all text-xs font-normal text-black/45 dark:text-white/45">
								&lt;{senderEmail}&gt;
							</span>
						</span>
					</div>
					<div className="flex gap-3">
						<span className="w-12 shrink-0 text-black/45 dark:text-white/45">
							Subject
						</span>
						<span>{edition.subject}</span>
					</div>
				</div>
				<iframe
					title={`${edition.label} email preview`}
					srcDoc={edition.html}
					className="block w-full border-0"
					style={{ height: mobile ? 1470 : 1190 }}
				/>
			</div>
		</PageContainer>
	);
}
