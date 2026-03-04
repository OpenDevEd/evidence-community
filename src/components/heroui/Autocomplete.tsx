import { extendVariants } from "@heroui/react";
import { Autocomplete as HeroUIAutocomplete } from "@heroui/react";

export const Autocomplete = extendVariants(HeroUIAutocomplete, {
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
