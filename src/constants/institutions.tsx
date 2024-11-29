import Image from "next/image";
import AboutUs from "@/components/icons/AboutUs";

export const INSTITUTION_LOGOS: Record<string, React.ReactNode> = {
	"EdTech Hub": (
		<Image
			src="/institutions/EdTechHub.png"
			alt="EdTech Hub"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
	"Open Development & Education": <AboutUs className="fill-accent size-6" />,
	IIEP: (
		<Image
			src="/institutions/IIEP.png"
			alt="IIEP"
			width={24}
			height={24}
			className="size-6 object-contain"
		/>
	),
	"British Standards Institution": (
		<Image
			src="/institutions/BSI.png"
			alt="BSI"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
	"UK National Commission to UNESCO": (
		<Image
			src="/institutions/UKUNESCO.png"
			alt="UK National Commission to UNESCO"
			width={24}
			height={24}
			className="size-6 object-contain dark:bg-white/80 p-0.5 rounded-md"
		/>
	),
};
