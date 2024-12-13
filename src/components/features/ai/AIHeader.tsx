import { ModalHeader } from "@nextui-org/react";
import { BsStars } from "react-icons/bs";
import { Button } from "@/components/nextui/Button";
import { LuX } from "react-icons/lu";
import { useTranslations } from "next-intl";
import { SectionTitle } from "@/components/typography/SectionTitle";

export default function AIHeader({
	isLoading,
	onClose,
	children,
}: {
	isLoading?: boolean;
	onClose: () => void;
	children?: React.ReactNode;
}) {
	return (
		<ModalHeader className="flex items-center justify-between gap-2">
			<SectionTitle
				startContent={<BsStars className="text-accent" />}
				className="flex items-center gap-2"
			>
				<span className="bg-gradient-to-r from-accent dark:to-accent-800 to-accent-600 bg-clip-text text-transparent">
					{children}
				</span>
			</SectionTitle>
			<Button
				onClick={onClose}
				isIconOnly
				variant="transparent"
				className="xl:px-0 px-0 translate-x-2 rtl:-translate-x-2"
				startContent={
					<LuX className="size-6 text-accent" />
				}
			/>
		</ModalHeader>
	);
}
