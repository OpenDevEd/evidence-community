import { twMerge } from "tailwind-merge";

export function ListItem({
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
  