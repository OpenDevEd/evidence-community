import { createContext } from "react";

/**
 * Whether the item page plays its entrance animations. It does not when the full record replaces a page already
 * drawn from the list the reader came from; nested AnimatePresence boundaries read this so they skip them too.
 */
export const EntranceContext = createContext(true);
