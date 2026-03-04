"use client";

import { extendVariants, Skeleton as HeroUISkeleton } from "@heroui/react";

export const Skeleton = extendVariants(HeroUISkeleton, {
  variants: {
    color: {
      default: {
        base: "after:dark:bg-secondary-400 dark:bg-secondary-400",
      },
    },
    custom: {
      default: {
        base: "rtl:before:translate-x-0"
      }
    }
  },
  defaultVariants: {
    color: "default",
    custom: "default"
  },
});
