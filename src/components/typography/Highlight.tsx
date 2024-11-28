import { twMerge } from "tailwind-merge";

export function Highlight({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <span className={twMerge("text-accent font-medium", className)}>
        {children}
      </span>
    );
  }