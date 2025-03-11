"use client";

import { extendVariants, CheckboxGroup as NextUICheckboxGroup } from "@nextui-org/react";

export const CheckboxGroup = extendVariants(NextUICheckboxGroup, {
  variants: {
    size: {
      lg: {
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
