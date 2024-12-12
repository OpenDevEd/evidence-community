import { useRef, useState } from "react";
import { Item } from "@/app/api/item/types";
import { Skeleton } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import Image from "next/image";
import { LuDownload } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { FaEye } from "react-icons/fa";
import posthog from "posthog-js";
import { useTranslations } from "next-intl";

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
	const imageHeight = imageRef.current?.height;
	const parentRef = useRef<HTMLDivElement>(null);
	const parentHeight = parentRef.current?.clientHeight;
	const t = useTranslations("ui");

	return (
		<div
			ref={parentRef}
			className=" flex gap-4 bg-black/[4%] border-2 border-white/10 p-4 rounded-2xl relative w-full"
			key={data.id}
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
					"w-48 bottom-0 top-4 absolute overflow-hidden transition-all",
					canHover && "hover:top-[var(--image-height)]"
				)}
			>
				{data?.PDFCoverPageImage ? (
					<Skeleton isLoaded={loaded} className={"rounded-xl w-full"}>
						<Image
							ref={imageRef}
							src={data?.PDFCoverPageImage || ""}
							alt={data?.filename || ""}
							width={512}
							height={512}
							onLoad={() => setLoaded(true)}
							className="rounded-xl bg-accent w-full"
						/>
					</Skeleton>
				) : (
					<div className="rounded-xl bg-accent w-full aspect-[9/12]" />
				)}
			</div>
			<div className="flex flex-col gap-2 h-full ltr:ml-52 rtl:mr-52">
				<h1 className="text-lg font-medium">{data.filename}</h1>
				<div className="flex gap-2">
					<Button
						size="sm"
						onClick={() => {
							window.open(data.url || "", "_blank");
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
						onClick={() => {
							downloadLink(data.url || "", data.filename || "", data.key || "");
						}}
					>
						{t("downloadAttachment")}
					</Button>
				</div>
			</div>
		</div>
	);
}
