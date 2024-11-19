"use client";
import { extendVariants, Input as NextUIInput } from "@nextui-org/react";

export const Input = extendVariants(NextUIInput, {
  variants: {
    color: {
      secondary: {
        inputWrapper: "bg-white dark:bg-secondary border-white/10 group-data-[focus]:bg-white dark:group-data-[focus]:bg-secondary group-data-[hover]:bg-black/[4%] dark:group-data-[hover]:bg-white/[4%]",
        input: "placeholder:text-black/60 dark:placeholder:text-white/40",
      },
    },
    variant: {
      default: {
        inputWrapper: "border",
      },
    },
    size: {
      md: {
        inputWrapper: "h-12",
      },
    },
    custom: {
      default: {
        inputWrapper: "rounded-2xl",
      },
    },
  },
  defaultVariants: {
    color: "secondary",
    size: "md",
    custom: "default",
    variant: "default",
  },
});
