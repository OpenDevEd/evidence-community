import { twMerge } from "@/lib/tw-merge";

export function ListItem({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <li
        className={twMerge("text-black dark:text-white/80 text-lg", className)}
      >
        {children}
      </li>
    );
  }
  