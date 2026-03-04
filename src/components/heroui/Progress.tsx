"use client";
import { extendVariants, Progress as HeroUIProgress } from "@heroui/react";

export const Progress = extendVariants(HeroUIProgress, {
  variants: {
    color: {
      primary: {
        track: "bg-black/10 dark:bg-white/10",
        indicator: "bg-accent",
      },
    },
  },
  defaultVariants: {
    color: "primary",
  },
}); 