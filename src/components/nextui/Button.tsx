"use client";
import { extendVariants, Button as NextUIButton } from "@nextui-org/react";

export const Button = extendVariants(NextUIButton, {
  variants: {
    color: {
      secondary:
        `text-black/80 dark:text-white/60 
        bg-white dark:bg-secondary 
        border-black/10 dark:border-white/10`,
      accent:
        `text-white dark:text-white/60 
        bg-accent dark:bg-accent-500 
        border-black/10 dark:border-white/10`,
    },
    variant: {
      default: "border-small rounded-2xl",
      solid: "border-none rounded-lg",
    },
    size: {
      lg: "px-3 gap-2 xl:px-6 xl:gap-3",
      xs: "text-xs px-3 h-8 gap-1",
    },
  },
  defaultVariants: {
    color: "secondary",
    variant: "default",
    size: "lg",
  },
});
