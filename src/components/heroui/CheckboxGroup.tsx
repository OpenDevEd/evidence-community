"use client";

import { extendVariants, CheckboxGroup as HeroUICheckboxGroup } from "@heroui/react";

export const CheckboxGroup = extendVariants(HeroUICheckboxGroup, {
  variants: {
    size: {
      xl: {
        base: "text-white/80",
        
      },
    },
    color: {
      primary: {
        base: "text-white/10",
      }
    },
  },
});
