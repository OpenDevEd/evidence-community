import { extendVariants } from "@nextui-org/react";
import { Autocomplete as NextUIAutocomplete } from "@nextui-org/react";

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
