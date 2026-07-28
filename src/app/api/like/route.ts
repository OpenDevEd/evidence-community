import { getDatabaseForConfig } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "../auth/[...nextauth]/config";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, sql, InferSelectModel } from "drizzle-orm";
import { getCachedUserLikes } from "../cache";
import { revalidatePath, revalidateTag } from "next/cache";
import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

export async function GET() {
  const config = await getConfigForEnabledFeature("login");
  if (!config) return featureUnavailableResponse();

  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDatabaseForConfig(config);
    const likes = await db.query.usersToLikes.findMany({
      where: eq(usersToLikes.userId, session.user.id),
      with: {
        item: true,
      },
    });

    revalidatePath("/profile/" + session.user.id);

    return NextResponse.json({ likes });
  } catch (error) {
    console.error("Error fetching likes:", error);
    return NextResponse.json(
      { error: "Failed to fetch likes" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const config = await getConfigForEnabledFeature("login");
  if (!config) return featureUnavailableResponse();

  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = await getDatabaseForConfig(config);
    const { itemKey } = await request.json();

    if (!itemKey) {
      return NextResponse.json(
        { error: "Item key is required" },
        { status: 400 }
      );
    }

    const result = await db
      .insert(usersToLikes)
      .values({
        userId: session.user.id,
        itemKey: itemKey,
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [usersToLikes.userId, usersToLikes.itemKey],
        set: {
          deleted: sql`NOT ${usersToLikes.deleted}`,
          updatedAt: new Date(),
        },
      })
      .returning();
    
    const cachedLikes = await getCachedUserLikes(session.user.id);
    const cachedLike = cachedLikes.find((like: InferSelectModel<typeof usersToLikes>) => like.itemKey === itemKey);
    if (cachedLike) {
      cachedLikes.splice(cachedLikes.indexOf(cachedLike), 1);
    }
    cachedLikes.push(result[0]);
    // setCachedUserLikes(session.user.id, cachedLikes);

    return NextResponse.json({ liked: !result[0].deleted });
  } catch (error) {
    console.error("Error handling like:", error);
    return NextResponse.json(
      { error: "Failed to process like" },
      { status: 500 }
    );
  }
}
