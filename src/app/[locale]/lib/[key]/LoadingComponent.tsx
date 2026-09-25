"use client";

import { ItemGetResponse } from "@/app/api/item/types";
import ItemPage from "@/components/features/newlib/ItemPage";

/** Placeholders while a record without a list copy loads. */
export default function LoadingComponent() {
	return <ItemPage data={undefined as unknown as ItemGetResponse} loading={true} />;
}
