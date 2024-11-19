"use client"
import {extendVariants, Button as NextUIButton} from "@nextui-org/react";

export const Button = extendVariants(NextUIButton, {
  variants: {
    color: {
      secondary: "text-primary/60 bg-secondary border-small border-primary/10",
    },
    custom: {
      default: "rounded-2xl"
    }
  },
  defaultVariants: {
    color: "secondary",
    custom: "default"
  },
});
