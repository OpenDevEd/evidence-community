"use client";
import type { ComponentProps } from "react";
import {
  extendVariants,
  Pagination as NextUIPagination,
} from "@nextui-org/react";

const StyledPagination = extendVariants(NextUIPagination, {
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
        // NextUI makes page numbers touch-none, so a swipe that starts on one can't scroll a pager too wide for the
        // screen (200% text on a phone). Previous and Next already let the browser pan.
        item: "rounded-lg touch-auto",
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

/** A pager that scrolls sideways when it doesn't fit. Chromium leaves a control that's partly out of view where it is
 * when the keyboard focuses it, so Tab to a half-hidden Next brings it fully into view here. */
export function Pagination({ onFocus, ...props }: ComponentProps<typeof StyledPagination>) {
  return (
    <StyledPagination
      {...props}
      onFocus={(event) => {
        if (event.target.matches(":focus-visible")) event.target.scrollIntoView({ block: "nearest", inline: "nearest" });
        onFocus?.(event);
      }}
    />
  );
}
