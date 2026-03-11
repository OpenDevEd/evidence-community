import GapMap from "@/components/pages/GapMap";
import { getGapMaps } from "@/lib/gapmaps";
import { notFound } from "next/navigation";
import config from "@/constants/config.json";

type Props = {
	params: Promise<{ slug: string }>;
};

export default async function GapMapPage({ params }: Props) {
	const { slug } = await params;
	const gapmaps = await getGapMaps();
	const exists = gapmaps.some((g) => g.slug === slug);

	if (!exists) {
		notFound();
	}

	const index = process.env.MEILI_INDEX || config.index;
	const src = `/gapmaps/${index}/${slug}.html`;

	return <GapMap src={src} />;
}
