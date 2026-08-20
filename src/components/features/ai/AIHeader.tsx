import { BsStars } from "react-icons/bs";
import GenericHeader from "../modals/GenericHeader";
import { twMerge } from "tailwind-merge";


export default function AIHeader({
	isLoading,
	onClose,
	children,
	actions,
	className,
}: {
	isLoading?: boolean;
	onClose: () => void;
	children?: React.ReactNode;
	actions?: React.ReactNode;
	className?: string;
}) {
	return (
		<GenericHeader
			onClose={onClose}
			startContent={<BsStars className="text-accent" />}
			actions={actions}
			classNames={{
				base: twMerge("flex items-center justify-between gap-2", className),
				title: "flex items-center gap-2",
				titleSpan: "bg-gradient-to-r from-accent dark:to-accent-800 to-accent-600 bg-clip-text text-transparent",
				button: "xl:px-0 px-0 translate-x-2 rtl:-translate-x-2",
				buttonIcon: "size-6 text-accent",
			}}
		>
			{children}
		</GenericHeader>
	)
}
