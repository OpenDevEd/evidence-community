"use client";
import { 
  extendVariants, 
  Table as NextUITable,
  TableHeader as NextUITableHeader,
  TableColumn as NextUITableColumn,
  TableBody as NextUITableBody,
  TableRow as NextUITableRow,
  TableCell as NextUITableCell,
} from "@nextui-org/react";

export const Table = extendVariants(NextUITable, {
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
export const TableHeader = NextUITableHeader;
export const TableColumn = NextUITableColumn;
export const TableBody = NextUITableBody;
export const TableRow = NextUITableRow;
export const TableCell = NextUITableCell; 