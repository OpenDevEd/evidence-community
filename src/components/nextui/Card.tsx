"use client";
import { extendVariants, Card as NextUICard } from "@nextui-org/react";

export const Card = extendVariants(NextUICard, {
  variants: {
    color: {
      tertiary: {
        base: "bg-white border-tertiary dark:bg-tertiary/20 dark:border-white/10",
      },
      accent: {
        base: "bg-accent border-accent dark:bg-accent/20 dark:border-white/10",
      },
      card: {
        base: "bg-white dark:bg-card dark:border-white/10",
      },
      transparent: {
        base: "bg-transparent border-transparent",
      },
    },
    variant: {
      default: {
        base: "rounded-2xl border",
      },
    },
    custom: {
      default: {
        base: "p-3",
      },
    },
  },
  defaultVariants: {
    color: "tertiary",
    variant: "default",
    custom: "default",
  },
});
    