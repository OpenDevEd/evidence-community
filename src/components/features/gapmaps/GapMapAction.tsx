"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { ArrowDown01Icon, MapsIcon } from "@hugeicons/core-free-icons";
import { Key, useMemo } from "react";
import { DropdownItem, DropdownMenu, DropdownTrigger } from "@nextui-org/react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/nextui/Button";
import { Dropdown } from "@/components/nextui/Dropdown";
import { useGapMaps } from "@/context/Providers";
import { resolveGapMapsByTags } from "@/lib/gapmap-links";

function openGapMap(href: string) {
	window.open(href, "_blank", "noopener,noreferrer");
}

export default function GapMapAction({
	tags,
	size = "sm",
	color = "secondary",
}: {
	tags?: string[] | null;
	size?: React.ComponentProps<typeof Button>["size"];
	color?: React.ComponentProps<typeof Button>["color"];
}) {
	const t = useTranslations("ui");
	const gapmaps = useGapMaps();
	const matchedGapMaps = useMemo(
		() => resolveGapMapsByTags(tags, gapmaps),
		[tags, gapmaps],
	);

	if (!matchedGapMaps.length) return null;

	if (matchedGapMaps.length === 1) {
		const [gapmap] = matchedGapMaps;

		return (
			<Button
				size={size}
				color={color}
				onPress={() => openGapMap(gapmap.href)}
				startContent={<HugeiconsIcon icon={MapsIcon} className="size-4" />}
				aria-label={t("openGapMapAriaLabel", { label: gapmap.label })}
			>
				{t("openGapMap")}
			</Button>
		);
	}

	const handleAction = (key: Key) => {
		openGapMap(String(key));
	};

	return (
		<Dropdown>
			<DropdownTrigger>
				<Button
					size={size}
					color={color}
					startContent={<HugeiconsIcon icon={MapsIcon} className="size-4" />}
					endContent={<HugeiconsIcon icon={ArrowDown01Icon} className="size-4" />}
					aria-label={t("dropdownAriaLabel", { label: t("gapMaps") })}
				>
					{t("gapMaps")}
				</Button>
			</DropdownTrigger>
			<DropdownMenu onAction={handleAction}>
				{matchedGapMaps.map((gapmap) => (
					<DropdownItem key={gapmap.href}>{gapmap.label}</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	);
}
