"use client";
import {
  extendVariants,
  Pagination as NextUIPagination,
} from "@nextui-org/react";

export const Pagination = extendVariants(NextUIPagination, {
  variants: {
    color: {
      primary: {
        cursor: "bg-accent text-whit ",
        item: "bg-primary/[4%] text-primary/60 border-primary/[8%]",
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
