"use client"
import {extendVariants, Button as NextUIButton} from "@nextui-org/react";

export const Button = extendVariants(NextUIButton, {
  variants: {
    color: {
      secondary: "text-primary/60 bg-secondary border-primary/10",
    },
    variant: {
      default: "border-small rounded-2xl",
      solid: "border-none rounded-lg"
    },
    size: {
      lg: "",
      xs: "text-xs px-3 h-8 gap-1  font-light"
    },
  },
  defaultVariants: {
    color: "secondary",
    variant: "default",
    size: "lg"
  },
});
