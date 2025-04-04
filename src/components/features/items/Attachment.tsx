"use client";

import { useRef, useState, useEffect } from "react";
import { Item } from "@/app/api/item/types";
import { Link, Skeleton } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Image from "next/image";
import { LuDownload } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { FaEye } from "react-icons/fa";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";
import useBreakpoint from "@/hooks/useBreakpoint";
import { Card } from "@/components/nextui/Card";

function downloadLink(url: string, filename: string, key: string) {
	fetch(url)
		.then((response) => response.blob())
		.then((blob) => {
			posthog.capture("download_attachment", {
				key,
				filename,
			});
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = filename;
			link.click();
		})
		.catch(console.error);
}

export default function Attachment({ data }: { data: Item }) {
	const [loaded, setLoaded] = useState(false);
	const canHover = loaded || !data?.PDFCoverPageImage;
	const imageRef = useRef<HTMLImageElement>(null);
	const parentRef = useRef<HTMLLIElement>(null);
	const [imageHeight, setImageHeight] = useState<number | undefined>(undefined);
	const [parentHeight, setParentHeight] = useState<number | undefined>(undefined);
	const t = useTranslations("ui");
	const isDesktop = useBreakpoint("md");

	// Update height measurements when window resizes
	useEffect(() => {
		const updateHeights = () => {
			setImageHeight(imageRef.current?.height);
			setParentHeight(parentRef.current?.clientHeight);
		};

		// Initial measurement
		updateHeights();
		
		// Add resize listener
		window.addEventListener('resize', updateHeights);
		
		// Clean up
		return () => window.removeEventListener('resize', updateHeights);
	}, [loaded]); // Re-run when image is loaded

	const downloadURL = `/lib/${data.parentItem}/download/${data.key}`;

	// Shared component for rendering the attachment image
	const AttachmentImage = ({ className }: { className?: string }) => (
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
						className={twMerge("rounded-xl bg-accent w-full", className)}
					/>
				</Skeleton>
			) : (
				<div className={twMerge("rounded-xl bg-accent w-full aspect-[9/12]", className)} />
			)}
		</>
	);

	// Shared component for rendering the title
	const AttachmentTitle = ({ className }: { className?: string }) => (
		<h4 className={twMerge("text-lg font-medium", className)}>
			<Link
				href={downloadURL}
				target="_blank"
				className="dark:text-current text-current break-all text-lg"
			>
				{data.filename}
			</Link>
		</h4>
	);

	// Shared component for rendering the action buttons
	const AttachmentButtons = ({ className }: { className?: string }) => (
		<div className={twMerge("flex gap-2", className)}>
			<Button
				size="sm"
				onPress={() => {
					window.open(downloadURL, "_blank");
					posthog.capture("view_attachment", {
						key: data.key,
						filename: data.filename,
					});
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
					downloadLink(
						data.url || "",
						data.filename || "",
						data.key || ""
					);
				}}
			>
				{t("downloadAttachment")}
			</Button>
		</div>
	);

	return isDesktop ? (
		<Card
			// @ts-expect-error
			ref={parentRef}
			className="flex flex-col gap-4 p-4 rounded-2xl relative w-full overflow-visible dark:bg-background"
			key={data.id}
			color="card"
		>
			<div
				data-height={imageHeight}
				style={
					{
						"--image-height": `${
							-(imageHeight ?? 0) + (parentHeight ?? 0) - 4 * 4
						}px`,
					} as any
				}
				className={twMerge(
					"w-24 lg:w-48 bottom-0 top-4 absolute overflow-hidden transition-all",
					canHover && "hover:top-[var(--image-height)]"
				)}
			>
				<AttachmentImage />
			</div>
			<div className="flex flex-col gap-2 h-full lg:ltr:ml-52 lg:rtl:mr-52 ltr:ml-28 rtl:mr-28">
				<AttachmentTitle className="lg:line-clamp-none line-clamp-2" />
				<AttachmentButtons />
			</div>
		</Card>
	) : (
		<Card
			className="flex flex-col gap-4 p-4 rounded-2xl w-full dark:bg-background"
			key={data.id}
		>
			<div className="w-full max-w-[200px] mx-auto">
				<AttachmentImage />
			</div>
			<div className="flex flex-col gap-2">
				<AttachmentTitle className="line-clamp-2" />
				<AttachmentButtons className="flex-wrap" />
			</div>
		</Card>
	);
}
