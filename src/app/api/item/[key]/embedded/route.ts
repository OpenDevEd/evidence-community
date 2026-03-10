import { item } from "@/db/schema/tables/item";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { and, isNotNull, eq } from "drizzle-orm";
import { embeddings } from "@/db/schema/tables/embeddings";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {
	const params = await props.params;
	const { key } = params;

    const result = await db?.query.item.findMany({
        where: and(eq(item.parentItem, key), isNotNull(item.PDFCoverPageImage)),
        columns: {
            key: true,
        },
    });

    const attachments = result?.map((item) => item.key);

    const results = await Promise.all(attachments.map(async (attachment) => {
        const result = await db?.query.embeddings.findFirst({
            where: eq(embeddings.itemKey, attachment),
        });
        return result ? true : false;
    }));

    return NextResponse.json(results.every((result) => result) && result.length > 0, {
        headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
    });
}