"use client";

import { useEffect, useState } from "react";
import { ModalBody, ModalContent, ModalFooter, ModalHeader, Chip } from "@nextui-org/react";
import { Cancel01Icon, CheckmarkCircle02Icon, InboxIcon, Search01Icon, ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import DialogModal from "@/components/nextui/DialogModal";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { Spinner } from "@/components/nextui/Spinner";

// MOCK (mock/suggest-paper, OpenDevEd/new-el#777): no request goes to the community. Papers are looked up on
// OpenAlex from the browser, as the real lookup does on the server, and "sending" only shows what would happen.

/** Opens the dialog from anywhere on the page: the reader's menu and an empty search both do. */
export const openSuggestPapers = () => window.dispatchEvent(new Event("suggest-papers:open"));

type Found = { key: string; raw: string; title: string | null; authors: string; year: number | null; state: "looking" | "found" | "here" | "missing" };

/** The papers a paste names: DOIs, OpenAlex IDs and links to either, split on spaces and lines. */
function parse(text: string) {
	const seen = new Set<string>();
	return text.split(/\s+/u).filter(Boolean).flatMap((raw) => {
		const work = raw.match(/(?:^|\/)(W\d+)$/iu)?.[1]?.toUpperCase();
		const doi = work ? null : raw.match(/10\.\d{4,9}\/\S+/iu)?.[0]?.replace(/[.,;]+$/u, "").toLowerCase();
		const key = work ?? (doi ? `doi:${doi}` : null);
		if (!key || seen.has(key)) return [];
		seen.add(key);
		return [{ key, raw, path: work ?? `doi:${doi}` }];
	});
}

/** MOCK: the community already holds this one, to show the state. */
const ALREADY_HERE = "W2126314681";

async function lookUp(path: string): Promise<Omit<Found, "key" | "raw">> {
	const response = await fetch(`https://api.openalex.org/works/${path}?select=id,title,publication_year,authorships`).catch(() => null);
	if (!response?.ok) return { title: null, authors: "", year: null, state: "missing" };
	const work = (await response.json()) as { id: string; title: string | null; publication_year: number | null; authorships: { author: { display_name: string } }[] };
	const names = work.authorships.map((authorship) => authorship.author.display_name);
	return {
		title: work.title,
		authors: names.length > 3 ? `${names.slice(0, 3).join(", ")} et al.` : names.join(", "),
		year: work.publication_year,
		state: work.id.endsWith(ALREADY_HERE) ? "here" : "found",
	};
}

/**
 * Suggest papers to this community: a signed-in reader pastes DOIs or OpenAlex IDs, sees what they are, and sends
 * them to the community's review queue. The team reviews each before it goes live; the reader follows them in
 * Openscholar's Your submissions.
 */
export function SuggestPapersDialog() {
	const [open, setOpen] = useState(false);
	const [text, setText] = useState("");
	const [found, setFound] = useState<Found[] | null>(null);
	const [sent, setSent] = useState(false);
	const [sending, setSending] = useState(false);
	// A window event, so the reader's menu and an empty search open the same dialog.
	useEffect(() => {
		const show = () => setOpen(true);
		window.addEventListener("suggest-papers:open", show);
		return () => window.removeEventListener("suggest-papers:open", show);
	}, []);
	const pasted = parse(text);
	const ready = (found ?? []).filter((row) => row.state === "found");
	const looking = found?.some((row) => row.state === "looking") ?? false;
	const close = () => {
		setOpen(false);
		setText("");
		setFound(null);
		setSent(false);
	};
	const find = () => {
		setFound(pasted.map(({ key, raw }) => ({ key, raw, title: null, authors: "", year: null, state: "looking" })));
		for (const { key, path } of pasted) {
			void lookUp(path).then((result) => setFound((rows) => rows?.map((row) => (row.key === key ? { ...row, ...result } : row)) ?? rows));
		}
	};
	const send = () => {
		setSending(true);
		window.setTimeout(() => {
			setSending(false);
			setSent(true);
		}, 700);
	};

	return (
		<DialogModal isOpen={open} onOpenChange={(next) => (next ? setOpen(true) : close())} size="xl" scrollBehavior="inside">
			<ModalContent>
				<ModalHeader className="flex flex-col gap-1">
					<span className="text-lg font-semibold">Suggest papers</span>
					<span className="text-sm font-normal text-foreground/60 dark:text-white/60">
						Paste DOIs, OpenAlex IDs or links to them. The community&apos;s team reviews each before it goes live.
					</span>
				</ModalHeader>
				<ModalBody>
					{sent ? (
						<div className="flex flex-col items-center gap-3 py-8 text-center">
							<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-10 text-success" aria-hidden />
							<p className="text-base font-medium">{ready.length === 1 ? "1 paper sent for review" : `${ready.length} papers sent for review`}</p>
							<p className="max-w-sm text-sm text-foreground/60 dark:text-white/60">
								You&apos;ll see where each stands in Your submissions on Openscholar: waiting, published, or returned with the reviewer&apos;s reason.
							</p>
							<Button as="a" href="https://dev.openscholar.ai/evidence-communities?view=submissions" target="_blank" rel="noopener noreferrer" size="sm" variant="bordered" endContent={<HugeiconsIcon icon={ArrowUpRight01Icon} className="size-4" aria-hidden />}>
								Your submissions
							</Button>
						</div>
					) : (
						<>
							<Textarea
								aria-label="DOIs, OpenAlex IDs or links"
								placeholder={"10.1016/j.tate.2015.06.010\nhttps://openalex.org/W2126314681"}
								minRows={4}
								value={text}
								onValueChange={(value) => {
									setText(value);
									setFound(null);
								}}
								classNames={{ input: "font-mono text-xs" }}
							/>
							<div className="flex items-center justify-between gap-3">
								<span className="text-sm text-foreground/60 dark:text-white/60 tabular-nums">
									{pasted.length ? (pasted.length === 1 ? "1 paper" : `${pasted.length} papers`) : null}
								</span>
								<Button size="sm" variant="bordered" isDisabled={!pasted.length || found !== null} onPress={find} startContent={<HugeiconsIcon icon={Search01Icon} className="size-4" aria-hidden />}>
									Find papers
								</Button>
							</div>
							{found ? (
								<ul aria-label="Papers found" className="divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
									{found.map((row) => (
										<li key={row.key} className={`flex h-14 items-center gap-3 px-3 ${row.state === "here" ? "opacity-60" : ""}`}>
											{row.state === "looking" ? <Spinner size="sm" /> : null}
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-medium">{row.title ?? <span className="font-mono text-xs">{row.raw}</span>}</p>
												{row.title ? (
													<p className="flex min-w-0 gap-2 text-xs text-foreground/60 dark:text-white/60">
														<span className="truncate">{row.authors || "No authors listed"}</span>
														{row.year ? <span className="shrink-0 tabular-nums">{row.year}</span> : null}
													</p>
												) : null}
											</div>
											{row.state === "here" ? (
												<Chip size="sm" variant="flat" startContent={<HugeiconsIcon icon={CheckmarkCircle02Icon} className="size-3.5" aria-hidden />}>Already here</Chip>
											) : row.state === "missing" ? (
												<Chip size="sm" variant="flat" color="danger">Not found</Chip>
											) : row.state === "found" ? (
												<Button isIconOnly size="sm" variant="light" aria-label={`Leave out ${row.title ?? row.raw}`} onPress={() => setFound((rows) => rows?.filter((other) => other.key !== row.key) ?? rows)}>
													<HugeiconsIcon icon={Cancel01Icon} className="size-4" aria-hidden />
												</Button>
											) : null}
										</li>
									))}
								</ul>
							) : null}
						</>
					)}
				</ModalBody>
				<ModalFooter className="items-center justify-between">
					{sent ? (
						<Button className="ms-auto" color="accent" variant="solid" onPress={close}>Done</Button>
					) : (
						<>
							<span className="text-sm text-foreground/60 dark:text-white/60 tabular-nums">
								{found && !looking ? (ready.length === 1 ? "1 paper to suggest" : `${ready.length} papers to suggest`) : null}
							</span>
							<span className="flex gap-2">
								<Button variant="light" onPress={close}>Cancel</Button>
								<Button color="accent" variant="solid" isDisabled={!found || looking || !ready.length} isLoading={sending} onPress={send} startContent={sending ? null : <HugeiconsIcon icon={InboxIcon} className="size-4" aria-hidden />}>
									Send for review
								</Button>
							</span>
						</>
					)}
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}
