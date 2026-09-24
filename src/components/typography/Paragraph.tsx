import { twMerge } from "@/lib/tw-merge";

export function Paragraph({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <p
        className={twMerge("text-black dark:text-white/80 text-lg", className)}
      >
        {children}
      </p>
    );
  }
  