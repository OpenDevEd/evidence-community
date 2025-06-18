import { notFound } from "next/navigation";
import { getCachedItemSmall } from "@/app/api/cache";
import ItemPage from "@/components/features/newlib/ItemPage";
import { ItemGetResponse } from "@/app/api/item/types";

async function getCurrentItem(key: string) {
    const data = await getCachedItemSmall(key).catch(() => ({ item: undefined }));
    if (data?.item && !data?.item?.citation) {
        return await getCachedItemSmall(key, true).catch(() => ({ item: undefined }));
    }
    return data;
}


export default async function NewLibPage({
	params,
}: {
	params: { key: string };
}) {
	const { key } = await params;
	const data = await getCurrentItem(key);

	if (!data) {
		return notFound();
	}
	return <ItemPage data={data as ItemGetResponse} loading={false} />;
}
