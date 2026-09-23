"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Download01Icon, ViewIcon } from "@hugeicons/core-free-icons";
import { useRef, useState, useEffect } from "react";
import { Item } from "@/app/api/item/types";
import { Link, Spinner } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { PdfCover } from "./PdfCover";
import { Button } from "@/components/nextui/Button";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/nextui/Card";
import useSWR from "swr";
import { fetcherExternal } from "@/lib/utils";
import { trackAttachmentInteraction } from "@/lib/analytics";
import { useSession } from "next-auth/react";

function downloadLink(url: string, filename: string) {
	fetch(url)
		.then((response) => response.blob())
		.then((blob) => {
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			link.click();
		})
		.catch(console.error);
}

function getAttachmentFromOpenAlex(work: any) {
	const potentialLocations = [
		work.locations?.find((location: any) => location.pdf_url),
		work.locations?.find((location: any) => location.landing_page_url),
		work.locations?.[0],
	];

	const pdfUrl = potentialLocations.find(
		(location) => location?.pdf_url && location.is_oa,
	)?.pdf_url;

	return pdfUrl;
}

export default function Attachment({ data, item }: { data: Item; item: Item }) {
	const { data: session } = useSession();
	const locale = useLocale();

	const [loaded, setLoaded] = useState(false);
	const canHover = loaded || !data?.PDFCoverPageImage;
	const imageRef = useRef<HTMLImageElement>(null);
	const parentRef = useRef<HTMLLIElement>(null);
	const [imageHeight, setImageHeight] = useState<number | undefined>(
		undefined,
	);
	const [parentHeight, setParentHeight] = useState<number | undefined>(
		undefined,
	);
	const t = useTranslations("ui");
	const hasImage = data.PDFCoverPageImage;
	const trackAttachment = (
		action: "view" | "download" | "open",
		source: "internal" | "external",
	) => {
		trackAttachmentInteraction({
			action,
			source,
			parentType: item.itemType,
			locale,
			isAuthenticated: Boolean(session),
		});
	};

	const isExternal =
		!data.PDFCoverPageImage &&
		data.tags?.some((tag: string) => tag.toLowerCase() === "_auto-process");

	const { data: itemFromOpenAlex, isLoading: isLoadingOpenAlex } = useSWR(
		isExternal ? "https://api.openalex.org/works/" + data.parentItem : null,
		fetcherExternal,
	);
	const pdfUrl =
		isExternal && !isLoadingOpenAlex && itemFromOpenAlex
			? getAttachmentFromOpenAlex(itemFromOpenAlex)
			: null;
	const shouldShowLoading = isExternal && isLoadingOpenAlex;

	// Update height measurements when window resizes
	useEffect(() => {
		const updateHeights = () => {
			setImageHeight(imageRef.current?.height);
			setParentHeight(parentRef.current?.clientHeight);
		};

		// Initial measurement
		updateHeights();

		// Add resize listener
		window.addEventListener("resize", updateHeights);

		// Clean up
		return () => window.removeEventListener("resize", updateHeights);
	}, [loaded]); // Re-run when image is loaded

	const downloadURL = `/lib/${data.parentItem}/download/${data.key}`;

	const attachmentImage = (
		<>
			<PdfCover
				ref={imageRef}
				src={data?.PDFCoverPageImage}
				alt={t("pdfPreviewAlt", {
					filename: data?.filename || t("document"),
				})}
				onLoad={() => setLoaded(true)}
			/>
		</>
	);

	const attachmentTitle = (
		<h4 className="text-lg font-medium line-clamp-2 lg:line-clamp-none">
			<Link
				href={isExternal ? pdfUrl : downloadURL}
				target="_blank"
				className="dark:text-current text-current text-wrap-anywhere text-lg"
				onClick={() =>
					trackAttachment(
						isExternal ? "open" : "view",
						isExternal ? "external" : "internal",
					)
				}
			>
				{isExternal ? itemFromOpenAlex?.title : data.filename}
			</Link>
		</h4>
	);

	const attachmentButtons = (
		<div className="flex gap-2 flex-wrap md:flex-nowrap">
			{!isExternal ? (
				<>
					<Button
						size="sm"
						onPress={() => {
							trackAttachment("view", "internal");
							window.open(downloadURL, "_blank");
						}}
						startContent={<HugeiconsIcon icon={ViewIcon} className="size-5" />}
					>
						{t("viewAttachment")}
					</Button>
					<Button
						size="sm"
						color="accent"
						startContent={<HugeiconsIcon icon={Download01Icon} className="size-5" />}
						onPress={() => {
							trackAttachment("download", "internal");
							downloadLink(data.url || "", data.filename || "");
						}}
					>
						{t("downloadAttachment")}
					</Button>
				</>
			) : (
				<Button
					size="sm"
					color="accent"
					startContent={<HugeiconsIcon icon={Download01Icon} className="size-5" />}
					onPress={() => {
						trackAttachment("open", "external");
						window.open(pdfUrl, "_blank");
					}}
				>
					{t("openDocument")}
				</Button>
			)}
		</div>
	);

	return (
		<Card
			// @ts-expect-error temporary
			ref={parentRef}
			className={twMerge(
				"flex flex-col gap-4 p-4 rounded-2xl w-full dark:bg-background",
				hasImage && "md:relative md:overflow-visible",
			)}
			key={data.key}
			color="card"
		>
			{shouldShowLoading && (
				<div className="absolute inset-0 bg-background/50 flex items-center justify-center">
					<Spinner />
				</div>
			)}
			{hasImage && (
				<div
					data-height={imageHeight}
					style={
						{
							"--image-height": `${
								-(imageHeight ?? 0) +
								(parentHeight ?? 0) -
								4 * 4
							}px`,
						} as any
					}
					className={twMerge(
						"mx-auto w-full max-w-50",
						"md:w-24 lg:w-48 md:max-w-none md:mx-0 md:bottom-0 md:top-4 md:absolute md:overflow-hidden md:transition-all",
						canHover && "md:hover:top-(--image-height)",
					)}
				>
					{attachmentImage}
				</div>
			)}
			<div
				className={twMerge(
					"flex flex-col gap-2",
					hasImage
						? "md:h-full md:ltr:ml-28 md:rtl:mr-28 lg:ltr:ml-52 lg:rtl:mr-52"
						: "",
					shouldShowLoading && "opacity-0",
				)}
			>
				{attachmentTitle}
				{attachmentButtons}
			</div>
		</Card>
	);
}
