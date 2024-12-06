import { twMerge } from "tailwind-merge";

export function SectionTitle({
    children,
    className,
    startContent,
  }: {
    children: React.ReactNode;
    className?: string;
    startContent?: React.ReactNode;
  }) {
    return (
      <h2
        className={twMerge(
          "text-black dark:text-white/80 font-medium text-2xl",
          className
        )}
      >
        {startContent}
        {children}
      </h2>
    );
  }