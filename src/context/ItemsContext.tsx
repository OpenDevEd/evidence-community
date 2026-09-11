"use client";

import { createContext } from "react";
import type { useItemsList } from "@/hooks/useItemsList";

export const ItemsContext = createContext<ReturnType<typeof useItemsList>>(
	{} as ReturnType<typeof useItemsList>,
);
