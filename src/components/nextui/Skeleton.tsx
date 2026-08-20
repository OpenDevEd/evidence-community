"use client";

import { extendVariants, Skeleton as NextUISkeleton } from "@nextui-org/react";

export const Skeleton = extendVariants(NextUISkeleton, {
  variants: {
    color: {
      default: {
        base: "after:dark:bg-secondary-400 dark:bg-secondary-400",
      },
    },
    custom: {
      default: {
        // Once loaded NextUI switches the base to overflow-visible but keeps
        // the shimmer ::before (translated a full width to the left). It is
        // invisible yet still hit-testable, so it stole clicks from whatever
        // sat beside the card (the inline chat). Pseudo-elements must never
        // take pointer events.
        base: "rtl:before:translate-x-0 before:pointer-events-none after:pointer-events-none"
      }
    }
  },
  defaultVariants: {
    color: "default",
    custom: "default"
  },
});
