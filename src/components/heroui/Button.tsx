"use client";
import { extendVariants, Button as HeroUIButton } from "@heroui/react";

export const Button = extendVariants(HeroUIButton, {
  variants: {
    color: {
      secondary:
        `text-black/80 dark:text-white/60 
        bg-white dark:bg-secondary 
        border-black/10 dark:border-white/10`,
      card:
        `text-white dark:text-white 
        bg-white/50 dark:bg-card 
        border-black/10 dark:border-white/10`,
      accent:
        `text-white dark:text-white 
        bg-accent dark:bg-accent-500 
        border-black/10 dark:border-white/10`,
      tertiary:
        `text-black dark:text-white 
        bg-tertiary/20 dark:bg-tertiary/20 
        border-black/10 dark:border-white/10`,
      success:
        `text-white dark:text-white 
        bg-success dark:bg-success-500 
        border-black/10 dark:border-white/10`,
      danger:
        `text-white dark:text-white 
        bg-red-500 dark:bg-red-500 
        border-black/10 dark:border-white/10`,
    },
    variant: {
      default: "border-small rounded-2xl",
      solid: "border-none rounded-lg",
      transparent: "bg-transparent dark:bg-transparent border-none",
      invisible: "!bg-transparent !border-none !bg-transparent !p-0 !min-w-0 !min-h-0 !h-auto !w-auto",
    },

    size: {
      lg: "px-3 gap-2 xl:px-6 xl:gap-3",
      md: "px-3 gap-2 xl:px-6 xl:gap-3 h-10",
      xs: "text-xs px-3 h-8 gap-1",
    },

    isIconOnly: {
      true: "!px-0 !min-w-0 !aspect-square",
    }
  },
  defaultVariants: {
    color: "secondary",
    variant: "default",
    size: "lg",
  },
});
