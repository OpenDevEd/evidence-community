import { twMerge } from "tailwind-merge";

export function SectionTitle({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <h2
        className={twMerge(
          "text-black dark:text-white/80 font-medium text-xl",
          className
        )}
      >
        {children}
      </h2>
    );
  }