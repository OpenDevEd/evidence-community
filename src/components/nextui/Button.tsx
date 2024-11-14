"use client"
import {extendVariants, Button as NextUIButton} from "@nextui-org/react";

export const Button = extendVariants(NextUIButton, {
  variants: {
    color: {
      primary: "text-primary/60 bg-secondary border-small border-primary/10",
    },
  },
  defaultVariants: {
    color: "primary",
  },
});
