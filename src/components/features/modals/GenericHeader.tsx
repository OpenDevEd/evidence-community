import { ModalHeader } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { LuX } from "react-icons/lu";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { twMerge } from "tailwind-merge";

export default function GenericHeader({ onClose, children, startContent, classNames }: { onClose: () => void, children?: React.ReactNode, startContent?: React.ReactNode, classNames?: { base?: string, title?: string, titleSpan?: string, button?: string, buttonIcon?: string } }) {
	return (
		<ModalHeader className={twMerge("flex items-center justify-between gap-2", classNames?.base)}>
			<SectionTitle
				startContent={startContent}
				className={twMerge("flex items-center gap-2", classNames?.title)}
			>
				<span className={twMerge(classNames?.titleSpan)}>
					{children}
				</span>
			</SectionTitle>
			<Button
				onPress={onClose}
				isIconOnly
				variant="transparent"
				className={twMerge("xl:px-0 px-0 translate-x-2 rtl:-translate-x-2", classNames?.button)}
				aria-label={"Close this popup"}
				startContent={
					<LuX className={twMerge("size-6", classNames?.buttonIcon)} />
				}
			/>
		</ModalHeader>
	)
}
