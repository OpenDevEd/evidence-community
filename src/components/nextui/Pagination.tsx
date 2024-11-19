"use client";
import {
  extendVariants,
  Pagination as NextUIPagination,
} from "@nextui-org/react";

export const Pagination = extendVariants(NextUIPagination, {
  variants: {
    color: {
      primary: {
        cursor: "bg-accent text-white ",
        item: "bg-white dark:bg-white/[4%] text-black/60 dark:text-white/60 border-white/0 dark:border-white/10",
      },
    },
    variant: {
      default: {
        item: "border",
      }
    },
    custom: {
      default: {
        item: "rounded-lg",
        cursor: "rounded-lg",
        wrapper: "gap-4",
      },
    }
  },
  defaultVariants: {
    color: "primary",
    custom: "default",
    variant: "default",
  },
});
