"use client";

import { LuChevronLeft, LuDownload, LuPrinter } from "react-icons/lu";
import { useRouter } from "next/navigation";
import { Button } from "@/components/nextui/Button";
import { TiDocumentText } from "react-icons/ti";
import { PiSlidersHorizontalBold } from "react-icons/pi";

export default function ItemControls() {
	const router = useRouter();

	return (
		<div className="flex justify-start gap-6 w-full">
			<Button
				startContent={<LuChevronLeft className="size-5" />}
				onClick={() => router.back()}
			>
				Return
			</Button>
			<Button
				className="ml-auto"
				startContent={<TiDocumentText className="size-5" />}
			>
				Read Document
			</Button>
			<Button startContent={<LuDownload className="size-5" />}>
				Download This Record
			</Button>
			<Button startContent={<LuPrinter className="size-5" />}>
				Print This Record
			</Button>
			<Button
				startContent={<PiSlidersHorizontalBold className="size-5" />}
			>
				Preferences
			</Button>
		</div>
	);
}