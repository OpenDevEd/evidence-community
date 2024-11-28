import { twMerge } from "tailwind-merge";

export function Paragraph({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <p
        className={twMerge("text-black dark:text-white/80 text-base", className)}
      >
        {children}
      </p>
    );
  }
  