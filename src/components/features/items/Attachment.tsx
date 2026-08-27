"use client";

import { useRef, useState, useEffect } from "react";
import { Item } from "@/app/api/item/types";
import { Link, Spinner } from "@nextui-org/react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { twMerge } from "tailwind-merge";
import Image from "next/image";
import { LuDownload } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { FaEye } from "react-icons/fa";
import { useLocale, useTranslations } from "next-intl";
import { Card } from "@/components/nextui/Card";
import useSWR from "swr";
import { fetcherExternal } from "@/lib/utils";
import { trackAttachmentInteraction } from "@/lib/analytics";
import { useSession } from "next-auth/react";
import { getOpenAlexPdfUrl } from "@/lib/openalex";
import { buildPdfDownloadPath } from "@/lib/ai/citations";
import { downloadFile } from "@/lib/download";

export default function Attachment({ data, item }: { data: Item; item: Item }) {
	const { data: session } = useSession();
	const locale = useLocale();

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
			? getOpenAlexPdfUrl(itemFromOpenAlex)
			: undefined;
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

	const downloadURL = buildPdfDownloadPath(data.parentItem || item.key, data.key);

	const renderAttachmentImage = (className?: string) => (
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
						className={twMerge(
							"rounded-xl bg-accent w-full",
							className
						)}
					/>
				</Skeleton>
			) : (
				<div
					className={twMerge(
						"rounded-xl bg-accent w-full aspect-[9/12]",
						className
					)}
				/>
			)}
		</>
	);

	const renderAttachmentTitle = (className?: string) => (
		<h4 className={twMerge("text-lg font-medium", className)}>
			<Link
				href={isExternal ? pdfUrl : downloadURL}
				target="_blank"
				className="dark:text-current text-current text-wrap-anywhere text-lg"
			>
				{isExternal ? itemFromOpenAlex?.title : data.filename}
			</Link>
		</h4>
	);

	const renderAttachmentButtons = (className?: string) => (
		<div className={twMerge("flex gap-2", className)}>
			{!isExternal ? (
				<>
					<Button
						size="sm"
						onPress={() => {
							trackAttachmentInteraction({
								action: "view",
								source: "internal",
								parentType: item.itemType,
								locale,
								isAuthenticated: Boolean(session?.user),
							});

							window.open(downloadURL, "_blank", "noopener,noreferrer");
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
							trackAttachmentInteraction({
								action: "download",
								source: "internal",
								parentType: item.itemType,
								locale,
								isAuthenticated: Boolean(session?.user),
							});

							downloadFile(data.url || "", data.filename || "").catch(
								console.error,
							);
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
					trackAttachmentInteraction({
						action: "open",
						source: "external",
						parentType: item.itemType,
						locale,
						isAuthenticated: Boolean(session?.user),
					});

						
						window.open(pdfUrl, "_blank", "noopener,noreferrer");
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
			key={data.id}
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
					{renderAttachmentImage()}
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
				{renderAttachmentTitle("line-clamp-2 lg:line-clamp-none")}
				{renderAttachmentButtons("flex-wrap md:flex-nowrap")}
			</div>
		</Card>
	);
}
