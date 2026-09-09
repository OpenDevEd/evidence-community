import type { ReactNode } from "react";
import Link from "next/link";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Mail01Icon, ArrowRight01Icon, ArrowLeft01Icon } from "@hugeicons/core-free-icons";
export const muted = "text-black/60 dark:text-white/60";
export function Icon({ value, size = 18 }: { value: typeof Mail01Icon; size?: number }) {
  return <HugeiconsIcon icon={value} size={size} aria-hidden className="shrink-0" />;
}
export function TextLink({ href, children, back = false }: { href: string; children: ReactNode; back?: boolean }) {
  return <Link href={href} className={`inline-flex items-center gap-2 rounded-md text-sm font-medium outline-offset-4 transition-colors hover:text-accent ${back ? muted : "text-accent"}`}>
    {back && <Icon value={ArrowLeft01Icon} size={16} />}{children}{!back && <Icon value={ArrowRight01Icon} size={16} />}
  </Link>;
}
