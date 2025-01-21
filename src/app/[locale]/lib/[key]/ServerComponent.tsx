import { ItemGetResponse } from "@/app/api/item/types";
import { getCurrentItem } from "./page";
import ItemComponent from "@/components/pages/Item";

export default async function ServerComponent( props: {
    params: Promise<{ key: string }>;
}) {
    const params = await props.params;
    const data = await getCurrentItem(params.key);
        
    return <ItemComponent data={data as ItemGetResponse} loading={false} />;
}