"use client";

import { useRef, useState, useEffect } from "react";
import { Item } from "@/app/api/item/types";
import { Link, Skeleton, Spinner } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Image from "next/image";
import { LuDownload } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { FaEye } from "react-icons/fa";
import { useTranslations } from "next-intl";
import { Card } from "@/components/nextui/Card";
import useSWR from "swr";
import { fetcherExternal } from "@/lib/utils";
import {
	getAnalyticsDistinctId,
	PdfEventParams,
	trackPDFDownload,
	trackPDFView,
} from "@/lib/analytics";
import { useSession } from "next-auth/react";
import { Session } from "next-auth";
import { useUtm } from "@/hooks/useUtm";
import { StoredUtm } from "../UtmProvider";

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
		(location) => location?.pdf_url && location.is_oa
	)?.pdf_url;

	return pdfUrl;
}

function getPayload(
	data: Item,
	item: Item,
	session: Session | null,
	method: PdfEventParams["method"],
	link_text: string,
	utm: StoredUtm | null
): PdfEventParams {
	const posthog_distinct_id = getAnalyticsDistinctId() ?? undefined;

	return {
		file_id: data.key,
		filename: data.filename || "",
		file_title: data.title || "",
		parent_id: item.key,
		parent_title: item.title || "",
		parent_type: item.itemType || "",
		file_mime_type: data.contentType || "",
		file_md5: data.md5 || "",
		posthog_distinct_id: posthog_distinct_id,
		user_id: session?.user.id || "",
		method: method,
		link_text: link_text,
		link_url: data.url || "",
		...utm?.utm,
	};
}

export default function Attachment({ data, item }: { data: Item; item: Item }) {
	const { data: session, update } = useSession();
	const utm = useUtm();

	const [loaded, setLoaded] = useState(false);
	const canHover = loaded || !data?.PDFCoverPageImage;
	const imageRef = useRef<HTMLImageElement>(null);
	const parentRef = useRef<HTMLLIElement>(null);
	const [imageHeight, setImageHeight] = useState<number | undefined>(
		undefined
	);
	const [parentHeight, setParentHeight] = useState<number | undefined>(
		undefined
	);
	const t = useTranslations("ui");
	const hasImage = data.PDFCoverPageImage;

	const isExternal =
		!data.PDFCoverPageImage &&
		data.tags?.some((tag: string) => tag.toLowerCase() === "_auto-process");

	const { data: itemFromOpenAlex, isLoading: isLoadingOpenAlex } = useSWR(
		isExternal ? "https://api.openalex.org/works/" + data.parentItem : null,
		fetcherExternal
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
			{data?.PDFCoverPageImage ? (
				<Skeleton isLoaded={loaded} className="rounded-xl w-full">
					<Image
						ref={imageRef}
						src={data?.PDFCoverPageImage || ""}
						alt={t("pdfPreviewAlt", {
							filename: data?.filename || t("document"),
						})}
						width={512}
						height={512}
						onLoad={() => setLoaded(true)}
						className="rounded-xl bg-accent w-full"
					/>
				</Skeleton>
			) : (
				<div
					className="rounded-xl bg-accent w-full aspect-[9/12]"
				/>
			)}
		</>
	);

	const attachmentTitle = (
		<h4 className="text-lg font-medium line-clamp-2 lg:line-clamp-none">
			<Link
				href={isExternal ? pdfUrl : downloadURL}
				target="_blank"
				className="dark:text-current text-current text-wrap-anywhere text-lg"
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
							const payload = getPayload(
								data,
								item,
								session,
								"view",
								t("viewAttachment"),
								utm
							);
							trackPDFView(payload);

							window.open(downloadURL, "_blank");
						}}
						startContent={<FaEye className="size-5" />}
					>
						{t("viewAttachment")}
					</Button>
					<Button
						size="sm"
						color="accent"
						startContent={<LuDownload className="size-5" />}
						onPress={() => {
							const payload = getPayload(
								data,
								item,
								session,
								"download",
								t("downloadAttachment"),
								utm
							);
							trackPDFDownload(payload);

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
					startContent={<LuDownload className="size-5" />}
					onPress={() => {
						const payload = getPayload(
							data,
							item,
							session,
							"open",
							t("openDocument"),
							utm
						);
						trackPDFView(payload);

						
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
				hasImage && "md:relative md:overflow-visible"
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
						"w-full max-w-[200px] mx-auto",
						"md:w-24 lg:w-48 md:max-w-none md:mx-0 md:bottom-0 md:top-4 md:absolute md:overflow-hidden md:transition-all",
						canHover && "md:hover:top-[var(--image-height)]"
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
					shouldShowLoading && "opacity-0"
				)}
			>
				{attachmentTitle}
				{attachmentButtons}
			</div>
		</Card>
	);
}
