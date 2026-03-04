"use client";
import { 
  extendVariants, 
  Table as HeroUITable,
  TableHeader as HeroUITableHeader,
  TableColumn as HeroUITableColumn,
  TableBody as HeroUITableBody,
  TableRow as HeroUITableRow,
  TableCell as HeroUITableCell,
} from "@heroui/react";

export const Table = extendVariants(HeroUITable, {
  variants: {
    color: {
      statistics: {
        wrapper: "bg-transparent shadow-none p-0",
        th: "bg-black/5 dark:bg-white/5 text-black dark:text-white",
        td: "text-black dark:text-white",
      },
    },
    variant: {
      default: {
        wrapper: "shadow-small rounded-large",
      },
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

// Export the table components as-is since they don't need custom variants
export const TableHeader = HeroUITableHeader;
export const TableColumn = HeroUITableColumn;
export const TableBody = HeroUITableBody;
export const TableRow = HeroUITableRow;
export const TableCell = HeroUITableCell; 