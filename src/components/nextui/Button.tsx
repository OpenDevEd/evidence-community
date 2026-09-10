"use client";
import { extendVariants, Button as NextUIButton } from "@nextui-org/react";

export const Button = extendVariants(NextUIButton, {
  variants: {
    color: {
      secondary:
        `text-black/80 dark:text-white/60 
        bg-white dark:bg-secondary 
        border-black/10 dark:border-white/10`,
      card:
        `text-white dark:text-white 
        bg-card_light/50 dark:bg-card
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
      muted: "border-none rounded-xl bg-default-100 text-black/75 font-medium shadow-none data-[hover=true]:bg-default-200 dark:bg-secondary dark:text-white/75 dark:data-[hover=true]:bg-white/[0.08] aria-pressed:bg-accent/15 aria-pressed:text-accent dark:aria-pressed:bg-accent/15 dark:aria-pressed:text-accent",
      default: "border-small rounded-2xl",
      solid: "border-none rounded-lg",
      transparent: "bg-transparent dark:bg-transparent border-none",
      invisible: "!bg-transparent !border-none !bg-transparent !p-0 !min-w-0 !min-h-0 !h-auto !w-auto",
    },

    size: {
      lg: "px-3 gap-2 xl:px-6 xl:gap-3 [&[data-loading=true]>svg]:hidden [&[data-loading=true]>div>div]:!size-5 [&[data-loading=true]>div>div>i]:!border-2",
      md: "px-3 gap-2 xl:px-6 xl:gap-3 h-10 [&[data-loading=true]>svg]:hidden [&[data-loading=true]>div>div]:!size-4 [&[data-loading=true]>div>div>i]:!border-2",
      xs: "text-xs px-3 h-8 gap-1 [&[data-loading=true]>svg]:hidden [&[data-loading=true]>div>div]:!size-3.5 [&[data-loading=true]>div>div>i]:!border-2",
    },

    isIconOnly: {
      true: "!px-0 !min-w-0 !aspect-square",
    }
  },
  compoundVariants: [{variant: "muted", size: "xs", class: "h-9 gap-1.5"}],
  defaultVariants: {
    color: "secondary",
    variant: "default",
    size: "lg",
  },
});
