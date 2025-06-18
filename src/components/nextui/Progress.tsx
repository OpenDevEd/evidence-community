"use client";
import { extendVariants, Progress as NextUIProgress } from "@nextui-org/react";

export const Progress = extendVariants(NextUIProgress, {
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