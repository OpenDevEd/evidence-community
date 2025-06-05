"use client";
import { extendVariants, Table as NextUITable } from "@nextui-org/react";

export const Table = extendVariants(NextUITable, {
  variants: {
    color: {
      statistics: {
        wrapper: "bg-transparent shadow-none p-0",
        th: "bg-black/5 dark:bg-white/5 text-black dark:text-white",
        td: "text-black dark:text-white",
      },
    },
    variant: {
      default: {
        wrapper: "shadow-small rounded-large",
      },
    },
  },
  defaultVariants: {
    variant: "default",
  },
}); 