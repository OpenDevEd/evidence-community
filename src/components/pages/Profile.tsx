"use client";

import Image from "next/image";
import { BsPen } from "react-icons/bs";
import AboutUs from "../icons/AboutUs";
import { Button } from "../nextui/Button";
import Resource from "../features/items/Resource";
import { useState } from "react";
import { Skeleton } from "../nextui/Skeleton";
import { useTranslations } from "next-intl";
import { useFormatter } from "next-intl";

function Pen() {
	return (
		<div className="rounded-full bg-primary dark:bg-secondary flex items-center justify-center p-1.5 size-6">
			<BsPen className="size-full fill-black/60 dark:fill-white/60 " />
		</div>
	);
}

export default function Profile({ data, likedPosts }: { data: any, likedPosts: any[] }) {
	const t = useTranslations("ui");
	const formatter = useFormatter();
	const [selectedTab, setSelectedTab] = useState("Liked Posts");

	return (
		<div className="w-full max-w-screen-2xl px-4 xl:px-14 flex gap-8 items-start">
			<div className="w-96 dark:bg-secondary bg-black/[4%] rounded-2xl shrink-0">
				<div className="w-full dark:bg-card bg-white rounded-2xl rounded-b-none overflow-hidden flex">
					<div className="w-1/4 aspect-square">
						{data.image ? (
							<Image
								src={data.image}
								alt={data.name}
								width={256}
								height={256}
								objectFit="cover"
								className="w-full h-full object-cover rounded-r-full"
							/>
						) : (
							<div className="w-full h-full bg-primary dark:bg-secondary flex items-center justify-center rounded-r-full">
								<AboutUs className="size-1/2 fill-white" />
							</div>
						)}
					</div>
					<div className="w-3/4 flex flex-col p-4 justify-center">
						<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
							{data.name ?? "____________________"}
							<Pen />
						</div>
						<div className="text-sm text-black/60 dark:text-white/60">
							Joined in {new Date(data.createdAt).getFullYear()}
						</div>
					</div>
				</div>
				<div className="w-full flex flex-col p-4 gap-4">
					<div className="flex gap-4">
						<div className="flex-1 flex flex-col items-center dark:bg-card bg-white rounded-2xl p-4">
							<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
								100
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								Followers
							</div>
						</div>
						<div className="flex-1 flex flex-col items-center dark:bg-card bg-white rounded-2xl p-4">
							<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
								100
							</div>
							<div className="text-sm text-black/60 dark:text-white/60">
								Following
							</div>
						</div>
					</div>
					<div className="flex flex-col gap-2">
						<div className="text-xl font-medium text-black/80 dark:text-white/80 flex items-center gap-2">
							About me
							<Pen />
						</div>
						<div className="text-sm text-black/60 dark:text-white/60 min-h-16">
							Lorem ipsum, dolor sit amet consectetur adipisicing
							elit. Saepe dicta omnis similique quasi blanditiis
							distinctio ipsum, rem vel dignissimos quo eaque ad,
							dolor cupiditate suscipit accusantium fugiat
							necessitatibus! Similique, labore?
						</div>
					</div>
					<Button color="accent">Follow</Button>
				</div>
			</div>
			<div className="w-full flex flex-col gap-4">
				<div className="flex w-full dark:bg-card bg-white rounded-xl overflow-hidden hidden">
					{
						["Liked Posts", "Recommendations Feed"].map((tab: string) => (
							<Button key={tab} size="sm" radius="none" color={selectedTab === tab ? "accent" : "default"} variant="light" onClick={() => setSelectedTab(tab)}>
								{tab}
							</Button>
						))
					}

				</div>
				<Skeleton
					isLoaded={!!data}
					className="flex items-center flex-1 rounded-2xl"
				>
					<h2 suppressHydrationWarning className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center gap-2">
						{t.rich("resourcesCount", {
							count: formatter.number(
								likedPosts.length
							),
							number: (chunks) => (
								<span suppressHydrationWarning className="text-2xl leading-6">
									{chunks}
								</span>
							),
						})}
					</h2>
				</Skeleton>
				<div className="w-full flex flex-col gap-4">
					{likedPosts.map((post: any) => (
						<Resource
							key={post.key}
							itemData={post}
							abstract={true}
							isLoading={false}
						/>
					))}
				</div>
			</div>
		</div>
	);
}
