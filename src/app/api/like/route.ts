import { db } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { authOptions, auth } from "../auth/[...nextauth]/config";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, sql, InferSelectModel } from "drizzle-orm";
import { cachedUserLikes } from "../cache";

export async function GET() {
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const likes = await db.query.usersToLikes.findMany({
      where: eq(usersToLikes.userId, session.user.id),
      with: {
        item: true,
      },
    });

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
  const session = await auth();

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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
    
    const cachedLikes = cachedUserLikes.get(session.user.id) || [];
    const cachedLike = cachedLikes.find((like: InferSelectModel<typeof usersToLikes>) => like.itemKey === itemKey);
    if (cachedLike) {
      cachedLikes.splice(cachedLikes.indexOf(cachedLike), 1);
    }
    cachedLikes.push(result[0]);
    cachedUserLikes.set(session.user.id, cachedLikes);

    return NextResponse.json({ liked: !result[0].deleted });
  } catch (error) {
    console.error("Error handling like:", error);
    return NextResponse.json(
      { error: "Failed to process like" },
      { status: 500 }
    );
  }
}
