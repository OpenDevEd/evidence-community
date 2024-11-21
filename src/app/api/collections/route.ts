import { db } from "@/db";
import { collection } from "@/db/schema/tables/collection";
import { InferSelectModel } from "drizzle-orm";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export type CollectionsGetResponse = {
  collections: InferSelectModel<typeof collection>[];
};

export async function GET(request: NextRequest) {
  const collections = await db.query.collection.findMany();

  return NextResponse.json<CollectionsGetResponse>({
    collections: collections as InferSelectModel<typeof collection>[],
  });
}
