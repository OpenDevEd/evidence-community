"use client";
import Image from "next/image";
import {
	FaLightbulb,
	FaSearch,
	FaShieldAlt,
	FaMobile,
	FaBolt,
	FaDatabase,
} from "react-icons/fa";
import {
	HiSparkles,
	HiDocumentText,
	HiCollection,
	HiCube,
	HiSparkles as HiSparkles2,
} from "react-icons/hi";
import { IoSpeedometer } from "react-icons/io5";
import { motion, useScroll, useTransform } from "framer-motion";
import { Feature } from "@/components/ui/Feature";
import { useRef } from "react";
import { Button } from "../nextui/Button";
import Link from "next/link";

export default function Home() {
	const { scrollY } = useScroll();
	const gradientRef = useRef<HTMLDivElement>(null);

	const { scrollYProgress } = useScroll({
		target: gradientRef,
		offset: ["start end", "end start"],
	});

	const rotateX = useTransform(scrollY, [0, 720], [60, 0]);
	const shadowOpacity = useTransform(scrollY, [256, 720], [1, 0]);
	const imageScale = useTransform(scrollY, [0, 720], [1.2, 1.0]);

	const gradientStyle = useTransform(
		scrollYProgress,
		[0, 1],
		["opacity(0) blur(50px)", "opacity(0.4) blur(150px)"]
	);

	const backgroundStyle = useTransform(
		scrollYProgress,
		[0, 1],
		["opacity(0) blur(0px)", "opacity(1) blur(125px)"]
	);

	const backgroundOpacity = useTransform(scrollY, [0, 512], [1, 0]);

	const imageSize = useTransform(scrollY, [512, 1024], ["50vw", "75vw"]);

	return (
		<div className="min-h-screen w-full flex flex-col items-center relative pt-48">
			{/* Main content */}
			<div className="h-96 flex flex-col justify-end items-center">
				<div className="flex flex-col gap-4 text-center relative items-center">
					<span className="flex items-center gap-2 text-sm font-medium text-accent/80 bg-accent/10 px-4 py-1 rounded-full">
						<HiSparkles className="text-lg" />
						Revolutionizing Research Analysis
					</span>
					<h1 className="text-6xl font-extrabold text-accent tracking-tight">
						<span className="inline-flex items-center gap-4">
							<FaLightbulb className="text-5xl text-yellow-500" />
							AI-Powered Evidence
						</span>
					</h1>
					<p className="text-xl dark:text-white/80 text-black/80 font-medium max-w-2xl">
						Transform your research with intelligent analysis and
						discover insights faster than ever before
					</p>
					<div className="w-full flex py-4 justify-center gap-4 z-20">
						<Link href="/lib">
							<Button color="accent">Get Started</Button>
						</Link>
						<Button color="secondary">Learn More</Button>
					</div>
					<div className="absolute inset-0 w-full h-full flex">
						<div className="absolute top-20 left-10 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl" />
						<div className="absolute bottom-20 right-10 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl" />
						<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-accent/10 rounded-full" />
						<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] border border-accent/20 rounded-full" />
						<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] border border-accent/30 rounded-full" />
					</div>
				</div>
			</div>
			<div className="w-full">
				<div className="min-h-[125vh]">
					<div className="sticky top-32 w-full flex justify-center ">
						<motion.div
							className="aspect-video rounded-2xl"
							style={{
								rotateX: rotateX,
								transformPerspective: 1000,
								transformStyle: "preserve-3d",
								width: imageSize,
							}}
						>
							<motion.div
								className="absolute inset-0 bg-accent -z-10 blur-3xl"
								style={{
									opacity: backgroundOpacity,
								}}
							></motion.div>
							<motion.div
								className="aspect-video overflow-hidden rounded-2xl"
								style={{ scale: imageScale }}
							>
								<Image
									src="/images/landing.png"
									alt="Landing"
									width={1280}
									height={720}
									className="w-full h-full object-cover "
									priority
								/>
								<motion.div
									className="absolute inset-0 -bottom-10 bg-gradient-to-t via-20%  dark:via-background via-background_light dark:from-background from-background_light dark:to-transparent z-20"
									style={{
										opacity: shadowOpacity,
									}}
								/>
							</motion.div>
						</motion.div>
					</div>
				</div>
			</div>
			<div className="min-h-screen w-full py-24 relative mt-48 ">
				<div className="w-full relative flex justify-center">
					<motion.div
						ref={gradientRef}
						className="absolute w-full -top-10 h-32 z-10 from-accent-900 to-transparent bg-gradient-to-b"
						style={{
							filter: gradientStyle,
						}}
					></motion.div>
				</div>

				<motion.div
					style={{
						filter: backgroundStyle,
					}}
					className="absolute inset-0 w-full h-full bg-accent/25"
				></motion.div>

				{/* Background decorative elements */}
				<div className="absolute inset-0 w-full h-full">
					<div className="absolute top-1/4 -left-64 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl animate-pulse" />
					<div className="absolute bottom-1/4 -right-64 w-[500px] h-[500px] bg-accent/5 rounded-full blur-3xl animate-pulse delay-1000" />
					<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] border border-accent/10 rounded-full animate-[spin_30s_linear_infinite]" />
					<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] border border-accent/20 rounded-full animate-[spin_20s_linear_infinite_reverse]" />
				</div>

				<div className="container mx-auto relative">
					<motion.div
						className="space-y-4 mb-20"
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
					>
						<span className="text-sm font-medium text-accent/80 bg-accent/10 px-4 py-1 rounded-full inline-flex items-center gap-2">
							<HiSparkles className="text-lg" />
							Packed with Features
						</span>
						<h2 className="text-5xl font-bold bg-gradient-to-r from-accent via-accent/90 to-accent/70 bg-clip-text text-transparent">
							Everything You Need
						</h2>
						<p className="text-xl text-muted-foreground max-w-2xl">
							Experience the next generation of research analysis
							with our comprehensive suite of features
						</p>
					</motion.div>

					<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
						<Feature
							icon={HiCube}
							title="Smart AI Screening"
							description="Advanced AI analysis that intelligently screens and processes your research materials"
							index={0}
						/>
						<Feature
							icon={FaSearch}
							title="AI-Powered Search"
							description="Intelligent search capabilities that understand context and deliver precise results"
							index={1}
						/>
						<Feature
							icon={HiDocumentText}
							title="Document Processing"
							description="Efficient processing of multiple document formats with advanced text extraction"
							index={2}
						/>
						<Feature
							icon={IoSpeedometer}
							title="Lightning Fast"
							description="Optimized performance ensuring quick analysis and real-time results"
							index={3}
						/>
						<Feature
							icon={FaShieldAlt}
							title="Enterprise Security"
							description="Bank-grade security measures to protect your sensitive research data"
							index={4}
						/>
						<Feature
							icon={FaBolt}
							title="SEO Optimized"
							description="Built-in SEO optimization to enhance your research visibility"
							index={5}
						/>
						<Feature
							icon={FaDatabase}
							title="Multiple Sources"
							description="Connect and analyze data from various sources in one unified platform"
							index={6}
						/>
						<Feature
							icon={HiCollection}
							title="Custom Collections"
							description="Create and manage personalized research collections with custom profiles"
							index={7}
						/>
						<Feature
							icon={HiSparkles2}
							title="State-of-the-Art AI"
							description="Powered by the latest language models for unparalleled analysis"
							index={8}
						/>
					</div>
				</div>
			</div>
		</div>
	);
}
