import { ReactNode, useCallback, useRef, useState } from "react";
import { Item } from "@/app/api/item/types";
import { creatorTypeLabels } from "@/db/schema/enums/creatorType";
import { Collection } from "@/app/api/collections/types";
import { Link, Skeleton } from "@nextui-org/react";
import { twMerge } from "tailwind-merge";
import { itemTypeLabels } from "@/db/schema/enums/itemType";
import { Creator } from "@/db/schema/tables/item";
import Image from "next/image";
import { LuDownload, LuPrinter } from "react-icons/lu";
import { Button } from "@/components/nextui/Button";
import { FaEye } from "react-icons/fa";

export const valueFormatter: Record<
	any,
	(value: any, item?: Item) => ReactNode | boolean
> = {
	id: () => false,
	version: () => false,
	key: (value) => false,
	updatedAt: () => false,
	createdAt: () => false,
	tags: () => false,
	groupExternalId: () => false,
	dateAdded: () => false,
	dateModified: () => false,
	relations: () => false,
	deleted: () => false,
	itemType: (value) => itemTypeLabels[value as keyof typeof itemTypeLabels]!,
	collections: () => false,
	creators: (value) => {
		if (!value) return null;
		if (value.length === 0) return null;
		return (
			<ul className="flex flex-col gap-2">
				{value.map((creator: Creator, index: number) => {
					const creatorTypeLabel =
						creatorTypeLabels[
							creator.creatorType as keyof typeof creatorTypeLabels
						];
					return (
						<li className="flex gap-2" key={index}>
							<span className="font-medium text-accent">
								{creator.firstName
									? `${creator.firstName}, ${creator.lastName}`
									: creator.name}
							</span>
							<span
								className={twMerge(
									"text-black/80 dark:text-white/80 capitalize",
									!creatorTypeLabel && "!text-red-500"
								)}
							>
								({creatorTypeLabel || creator.creatorType})
							</span>
						</li>
					);
				})}
			</ul>
		);
	},
	title: (value) => value,
	accessDate: (value) => value,
	collectionsData: (value) => {
		if (!value) return null;
		if (value.length === 0) return null;

		value.sort(
			(a: Collection, b: Collection) =>
				a.title?.localeCompare(b.title || "") || 0
		);

		return (
			<ul className="flex flex-col gap-2">
				{value.map((collection: Collection) => {
					const ancestry = collection.ancestry || [];
					return (
						<li key={collection.id}>
							<Link
								showAnchorIcon
								href={`/lib?collections=${[
									...ancestry,
									collection.key,
								].join(",")}`}
								className="text-tertiary-400"
							>
								<span className="text-black/60 dark:text-white/60 underline">
									{collection.title} / {collection.name}
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		);
	},
	date: (value) => {
		if (!value) return false;
		if (isNaN(new Date(value).getTime())) return false;
		return new Date(value).toLocaleDateString("en-GB", {
			year: "numeric",
			month: "long",
			day: "numeric",
		});
	},
	url: (value) => (
		<Link href={value} className="text-accent" showAnchorIcon>
			{value}
		</Link>
	),
	attachmentsData: (value) => {
		const filteredValue = value.filter(
			(data: any) => data.PDFCoverPageImage
		);
		if (filteredValue.length === 0) return false;

		const downloadLink = useCallback((url: string, filename: string) => {
			fetch(url)
				.then((response) => response.blob())
				.then((blob) => {
					const link = document.createElement("a");
					link.href = URL.createObjectURL(blob);
					link.download = filename;
					link.click();
				})
				.catch(console.error);
		}, []);

		return (
			<div className="flex flex-col gap-2 w-2/3">
				{value
					.filter((data: any) => data.PDFCoverPageImage)
					.map((data: Item) => {
						const [loaded, setLoaded] = useState(false);
						const canHover = loaded || !data?.PDFCoverPageImage;
						const imageRef = useRef<HTMLImageElement>(null);
						const imageHeight = imageRef.current?.height;
						const parentRef = useRef<HTMLDivElement>(null);
						const parentHeight = parentRef.current?.clientHeight;

						console.log(imageHeight);

						return (
							<div
								ref={parentRef}
								className=" flex gap-4 bg-black/[4%] border-2 border-white/10 p-4 rounded-2xl relative w-full"
								key={data.id}
							>
								<div
									data-height={imageHeight}
									style={{
										"--image-height": `${
											-(imageHeight ?? 0) + (parentHeight ?? 0) - (4 * 4)
										}px`,
									} as any}
									className={twMerge(
										"w-48 bottom-0 top-4 absolute overflow-hidden transition-all",
										canHover &&
											"hover:top-[var(--image-height)]"
									)}
								>
									{data?.PDFCoverPageImage ? (
										<Skeleton
											isLoaded={loaded}
											className={"rounded-xl w-full"}
										>
											<Image
												ref={imageRef}
												src={
													data?.PDFCoverPageImage ||
													""
												}
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
								<div className="flex flex-col gap-2 h-full ml-52">
									<h1 className="text-lg font-medium">
										{data.filename}
									</h1>
									<div className="flex gap-2">
										<Button
											size="sm"
											onClick={() => {
												window.open(
													data.url || "",
													"_blank"
												);
											}}
											startContent={
												<FaEye className="size-5" />
											}
										>
											View
										</Button>
										<Button
											size="sm"
											color="accent"
											startContent={
												<LuDownload className="size-5" />
											}
											onClick={() => {
												downloadLink(
													data.url || "",
													data.filename || ""
												);
											}}
										>
											Download
										</Button>
									</div>
								</div>
							</div>
						);
					})}
			</div>
		);
	},
};
