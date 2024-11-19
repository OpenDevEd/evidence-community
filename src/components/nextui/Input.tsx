"use client";
import { extendVariants, Input as NextUIInput } from "@nextui-org/react";

export const Input = extendVariants(NextUIInput, {
  variants: {
    color: {
      secondary: {
        inputWrapper: "bg-secondary border-primary/10",
        input: "placeholder:text-primary/40",
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
