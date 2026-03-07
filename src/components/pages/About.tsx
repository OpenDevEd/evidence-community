"use client";

import PageContainer from "../layout/PageContainer";
import { useEffect, useState } from "react";
import { Card } from "../heroui/Card";
import { Button } from "../heroui/Button";
import Link from "next/link";
import Image from "next/image";
import { Skeleton } from "../heroui/Skeleton";
import { FaQuestionCircle, FaLightbulb, FaAngleRight, FaCompass } from "react-icons/fa";
import { Divider } from "@heroui/react";

// Types for content structure
type ContentType = "text" | "list" | "section" | "image" | "image-row";

interface BaseContent {
	type: ContentType;
	emphasis?: "high" | "medium" | "low"; // Maps to different opacity levels
}

interface TextContent extends BaseContent {
	type: "text";
	content: string;
	links?: Array<{
		text: string;
		url: string;
		external?: boolean;
	}>;
}

interface ListContent extends BaseContent {
	type: "list";
	items: string[];
	numbered?: boolean; // Optional flag to make the list numbered
}

interface ImageContent extends BaseContent {
	type: "image";
	uri: string;
	alt: string;
	width?: number;
	height?: number;
}

interface ImageRowContent extends BaseContent {
	type: "image-row";
	images: {
		uri: string;
		alt: string;
		width?: number;
		height?: number;
	}[];
	gap?: number; // Gap between images in pixels
}

interface SectionContent extends BaseContent {
	type: "section";
	title: string;
	contents: (TextContent | ListContent | SectionContent | ImageContent | ImageRowContent)[];
}

interface FAQItem {
	question?: string;
	contents: (TextContent | ListContent | SectionContent | ImageContent | ImageRowContent)[];
}

export interface FAQSection {
	title?: string;
	label?: string;
	description?: string;
	items: FAQItem[];
}

// FAQ Data
const faqData: FAQSection = {
	title: "FAQ for edu-works",
	label: "FAQ",
	items: [
		{
			contents: [
				{
					type: "text",
					content: "Edulinks published by us government, therefore public domain. We are resisting the content.",
					emphasis: "high",
				},
			]
		},
		{
			question: "Where does the content come from?",
			contents: [
				{
					type: "text",
					content:
						"The content was retrieved from the internet archive, where a copy of edu-links had been archived.",
					emphasis: "high",
				},
			],
		},
		{
			question: "Do you have the copyrights / other rights to do so?",
			contents: [
				{
					type: "text",
					content:
						"US government content, such as content published by USAID, once published, is in the public domain. You might find it interesting to note that, by the same token, NASA content is in the public domain. This public domain rule is a really good thing the US government put in place.",
					emphasis: "high",
				},
				{
					type: "text",
					content:
						"In general, content created by the U.S. federal government is in the public domain, meaning it is not subject to copyright and can be freely used by anyone. This applies to most works created by government employees as part of their official duties, including text, images, audio, and video.",
					emphasis: "high",
				},
				{
					type: "text",
					content: "However, there are a few important exceptions:",
					emphasis: "medium",
				},
				{
					type: "list",
					items: [
						"Third-party content: If the government has used or incorporated content created by someone else (e.g., a contractor or private company), that part may still be copyrighted.",
						"State and local governments: Content from U.S. state or local governments is not automatically in the public domain—it depends on the specific state's laws and policies.",
						"Trademarks and logos: While the content may be public domain, certain uses of government logos or seals may be restricted by law.",
					],
					emphasis: "medium",
					numbered: true
				},
				{
					type: "text",
					content:
						"Would you like help finding or verifying whether a specific piece of government content is in the public domain?",
					emphasis: "high",
				},
			],
		},
		{
			question: "Can I contribute new content?",
			contents: [
				{
					type: "text",
					content: "Yes - log in here: …",
					emphasis: "high",
				},
			],
		},
		{
			question: "Can I request for my content to be removed?",
			contents: [
				{
					type: "text",
					content:
						"Content can be removed - the ultimate beneficiaries are….",
					emphasis: "high",
				},
			],
		},
	],
};

// Helper components for rendering content
const ContentRenderer = ({
	content,
}: {
	content: TextContent | ListContent | SectionContent | ImageContent | ImageRowContent;
}) => {
	const [imageLoadStates, setImageLoadStates] = useState<{[key: string]: boolean}>({});
	const getOpacityClass = (emphasis: "high" | "medium" | "low" = "high") => {
		const opacityMap = {
			high: "text-black/80 dark:text-white/80",
			medium: "text-black/60 dark:text-white/60",
			low: "text-black/40 dark:text-white/40",
		};
		return opacityMap[emphasis];
	};

	const handleImageLoad = (uri: string) => {
		setImageLoadStates(prev => ({
			...prev,
			[uri]: true
		}));
	};

	switch (content.type) {
		case "text":
			{
				let textContent = content.content;
				if (content.links) {
					// Sort links by their position in the text (to handle overlapping matches)
					const sortedLinks = [...content.links].sort((a, b) => 
						textContent.indexOf(a.text) - textContent.indexOf(b.text)
					);

					// Replace each link text with the actual link component
					for (const link of sortedLinks) {
						const parts = textContent.split(link.text);
						textContent = parts.reduce((acc: string, part: string, i: number) => {
							if (i === parts.length - 1) return acc + part;
							return acc + part + `<link>${link.text}</link>`;
						}, '');
					}

					// Split content into parts that are either text or link markers
					const parts = textContent.split(/(<link>.*?<\/link>)/);
					
					return (
						<p className={`${getOpacityClass(content.emphasis)} leading-relaxed`}>
							{parts.map((part: string, i: number) => {
								const linkMatch = part.match(/<link>(.*?)<\/link>/);
								if (linkMatch) {
									const linkText = linkMatch[1];
									const linkData = content.links?.find(link => link.text === linkText);
									if (!linkData) return linkText;

									const LinkComponent = linkData.external ? 'a' : Link;
									const linkProps = linkData.external ? {
										href: linkData.url,
										target: "_blank",
										rel: "noopener noreferrer",
										className: "text-accent underline decoration-accent/30 hover:decoration-accent/60 transition-colors"
									} : {
										href: linkData.url,
										className: "text-accent underline decoration-accent/30 hover:decoration-accent/60 transition-colors"
									};

									return <LinkComponent key={i} {...linkProps}>{linkText}</LinkComponent>;
								}
								return part;
							})}
						</p>
					);
				}

				return (
					<p className={`${getOpacityClass(content.emphasis)} leading-relaxed`}>
						{content.content}
					</p>
				);
			}
		case "list":
			return (
				<ul className="space-y-2">
					{content.items.map((item, index) => (
						<li
							key={index}
							className={`${getOpacityClass(content.emphasis)} leading-relaxed flex items-start gap-3`}
						>
							{content.numbered ? (
								<span className="flex items-center justify-center w-6 h-6 rounded-full bg-accent/10 text-accent text-sm font-medium flex-shrink-0">
									{index + 1}
								</span>
							) : (
								<span className="w-1.5 h-1.5 rounded-full bg-accent/60 mt-2.5 flex-shrink-0" />
							)}
							<span>{item}</span>
						</li>
					))}
				</ul>
			);
		case "image":
			return (
				<Skeleton isLoaded={imageLoadStates[content.uri]} className="w-full">
					<Image
						src={content.uri}
						alt={content.alt}
						width={content.width || 800}
						height={content.height || 400}
						className="w-full h-auto rounded-2xl"
						onLoad={() => handleImageLoad(content.uri)}
					/>
				</Skeleton>
			);
		case "image-row":
			return (
				<div 
					className="flex flex-col sm:flex-row w-full" 
					style={{ gap: content.gap || 16 }}
				>
					{content.images.map((image, index) => (
						<div key={index} className="flex-1">
							{image.uri ? (
								<Skeleton 
									isLoaded={imageLoadStates[image.uri]} 
									className="rounded-xl"
								>
									<div className="relative w-full h-full">
										<Image
											src={image.uri}
											alt={image.alt}
											width={image.width || 400}
											height={image.height || 300}
											className="w-full h-full object-contain rounded-2xl overflow-hidden"
											onLoad={() => handleImageLoad(image.uri)}
										/>
									</div>
								</Skeleton>
							) : (
								<div className="" />
							)}
						</div>
					))}
				</div>
			);
		case "section":
			return (
				<div className="space-y-2">
					<h3 className="text-xl font-semibold text-accent/90">
						{content.title}
					</h3>
					<div className="space-y-2">
						{content.contents.map((subContent, index) => (
							<ContentRenderer key={index} content={subContent} />
						))}
					</div>
				</div>
			);
		default:
			return null;
	}
};

// New component for the sidebar navigation
const SidebarNav = ({
	items,
	activeId,
}: {
	items: FAQItem[];
	activeId: string;
}) => {
	const navigationItems = items.filter(item => item.question);
	
	if (navigationItems.length === 0) return null;

	return (
		<aside className="hidden lg:block w-72 flex-shrink-0">
			<div className="sticky top-8">
				<nav className="rounded-2xl bg-black/[2%] dark:bg-white/[2%] border border-black/[3%] dark:border-white/[3%] p-4">
					<div className="flex items-center gap-2 mb-4">
						<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10">
							<FaCompass className="w-4 h-4 text-accent" />
						</div>
						<h3 className="text-lg font-semibold text-accent/90">
							Quick Navigation
						</h3>
					</div>
					<ul className="space-y-1">
						{navigationItems.map((item, index) => {
							const itemId = `about-${index}`;
							return (
								<li key={index}>
									<Link
										className={`group flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
											activeId === itemId
												? "bg-accent/10 text-accent"
												: "text-black/60 dark:text-white/60 hover:bg-black/[3%] dark:hover:bg-white/[3%]"
										}`}
										href={`#${itemId}`}
										prefetch={false}
									>
										<FaAngleRight 
											className={`w-3 h-3 transition-transform ${
												activeId === itemId 
													? "text-accent" 
													: "text-black/40 dark:text-white/40 group-hover:text-black/60 dark:group-hover:text-white/60"
											} ${
												activeId === itemId ? "rotate-90" : ""
											}`}
										/>
										<span className="text-sm">
											{item.question}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</nav>
			</div>
		</aside>
	);
};

export default function About({ faqData }: { faqData: FAQSection }) {
	const [activeId, setActiveId] = useState<string>("");

	useEffect(() => {
		const observerOptions = {
			root: null,
			rootMargin: "0px 0px -80% 0px",
			threshold: [0, 0.2, 0.4, 0.6, 0.8, 1],
		};

		const observerCallback: IntersectionObserverCallback = (entries) => {
			// Find the entry with the highest intersection ratio
			const mostVisible = entries.reduce((max, entry) => {
				return (entry.intersectionRatio > max.intersectionRatio) ? entry : max;
			}, entries[0]);

			if (mostVisible?.isIntersecting && mostVisible.intersectionRatio > 0.2) {
				setActiveId(mostVisible.target.id);
			}
		};

		const observer = new IntersectionObserver(observerCallback, observerOptions);

		// Observe all FAQ item sections that have questions
		const sections = document.querySelectorAll("[id^='about-']");
		sections.forEach((section) => observer.observe(section));

		// Cleanup
		return () => {
			sections.forEach((section) => observer.unobserve(section));
			observer.disconnect();
		};
	}, []);

	// Handle initial active section on mount
	useEffect(() => {
		const hash = window.location.hash.slice(1);
		if (hash && hash.startsWith('about-')) {
			setActiveId(hash);
			document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' });
		} else {
			// Set first section with a question as active if no hash
			const firstQuestionIndex = faqData.items.findIndex(item => item.question);
			if (firstQuestionIndex >= 0) {
				setActiveId(`about-${firstQuestionIndex}`);
			}
		}
	}, []);

	return (
		<PageContainer className="!overflow-visible">
			<div className="py-6">
				<div className="flex gap-16">
					<div className="flex-1 min-w-0">
						<section>
							{faqData.title && (
								<div className="mb-8 lg:mb-16">
									<div className="flex flex-col gap-6">
										<div className="flex items-start gap-6">
											<div className="flex flex-col items-start gap-1">
												<div className="flex items-center gap-3 mb-1">
													<div className="w-8 h-[2px] bg-accent/80" />
													<span className="text-sm font-medium text-accent/80">
														{faqData.label || "FAQ"}
													</span>
												</div>
												<h1 className="text-3xl lg:text-4xl xl:text-5xl font-bold tracking-tight">
													{faqData.title}
												</h1>
											</div>
										</div>
										
										{faqData.description && (
											<div className="flex gap-3 items-start max-w-2xl">
												<div className="w-8 h-[2px] bg-black/10 dark:bg-white/10 mt-3" />
												<p className="text-lg text-black/60 dark:text-white/60 leading-relaxed">
													{faqData.description}
												</p>
											</div>
										)}
									</div>
								</div>
							)}

							<div className="space-y-8">
								{faqData.items.map((item, index) => {
									const itemId = `about-${index}`;
									return (
										<div
											key={index}
											id={item.question ? itemId : undefined}
											className="scroll-mt-8 rounded-2xl -mx-4 px-4 py-4 hover:bg-black/[2%] dark:hover:bg-white/[2%] transition-colors"
										>
											{item.question && (
												<div className="flex items-center gap-3 mb-4">
													<div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10">
														<FaAngleRight className="w-4 h-4 text-accent" />
													</div>
													<h2 className="text-xl font-semibold text-accent/90 leading-8">
														{item.question}
													</h2>
												</div>
											)}
											<div className={`space-y-4 ${item.question ? 'pl-11' : ''}`}>
												{item.contents.map(
													(content, contentIndex) => (
														<div 
															key={contentIndex}
															className={`${
																content.type === 'image-row' 
																	? contentIndex > 0 && contentIndex < item.contents.length - 1
																		? 'my-6'  // Items both above and below
																		: contentIndex > 0
																			? 'mt-6'  // Only items above
																			: contentIndex < item.contents.length - 1
																				? 'mb-6'  // Only items below
																				: ''      // No items above or below
																	: ''
															}`}
														>
															<ContentRenderer
																content={content}
															/>
														</div>
													)
												)}
											</div>
										</div>
									);
								})}
							</div>
						</section>
					</div>
					<SidebarNav items={faqData.items} activeId={activeId} />
				</div>
			</div>
		</PageContainer>
	);
}
