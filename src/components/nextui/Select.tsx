"use client";
import { extendVariants, Select as NextUISelect } from "@nextui-org/react";

export const Select = extendVariants(NextUISelect, {
  variants: {
    color: {
      secondary: {
        trigger: "bg-secondary text-primary/60 border-primary/10",
        value: "!text-primary/60 font-medium text-base text-center",
        popoverContent: "bg-secondary border-primary/10 ",
      },
      tertiary: {
        trigger: "bg-secondary text-primary/60 border-primary/10",
        value: "!text-primary/60 font-medium text-base text-center",
        popoverContent: "bg-secondary border-primary/10 ",
      }
    },
    variant: {
      default: {
        trigger:
          "border-small",
        value: "font-medium text-base text-center",
        popoverContent: "border-small ",
      },
    },
    size: {
      sm: { 
        base: "max-w-52",
      }
    },
    custom: {
      default: {
        trigger: "h-12 min-h-0 px-6 rounded-2xl"
      }
    }
  },
  defaultVariants: {
    variant: "default",
    custom: "default",
    size: "sm",
    color: "secondary"
  },
});
