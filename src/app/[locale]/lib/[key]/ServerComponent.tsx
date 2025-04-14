import { ItemGetResponse } from "@/app/api/item/types";
import { getCurrentItem } from "./page";
import ItemComponent from "@/components/pages/Item";
import ItemPage from "@/components/features/newlib/ItemPage";
import { notFound } from "next/navigation";

export default async function ServerComponent( props: {
    params: Promise<{ key: string }>;
}) {
    const params = await props.params;
    const data = await getCurrentItem(params.key);

    if (!data || data.item === undefined) {
        return notFound();
    }

    return <ItemPage data={data as ItemGetResponse} loading={false} />
}