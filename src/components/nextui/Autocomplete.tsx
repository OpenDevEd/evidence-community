import { extendVariants } from "@heroui/react";
import { Autocomplete as NextUIAutocomplete } from "@heroui/react";

export const Autocomplete = extendVariants(NextUIAutocomplete, {
  variants: {
    color: {
      secondary: {

      }
    },
    variant: {
      default: {
      }
    },
    custom: {
      default: {
      }
    }
  },
  defaultVariants: {

  }
});
