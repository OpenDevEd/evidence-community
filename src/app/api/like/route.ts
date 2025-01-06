import { db } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import authOptions from "../auth/[...nextauth]/config";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and, sql } from "drizzle-orm";
import { cachedUserLikes } from "../cache";

export async function GET() {
  const session = await getServerSession(authOptions) as any;

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
  const session = await getServerSession(authOptions);

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
    cachedUserLikes.set(session.user.id, [...cachedLikes, result[0]]);

    return NextResponse.json({ liked: !result[0].deleted });
  } catch (error) {
    console.error("Error handling like:", error);
    return NextResponse.json(
      { error: "Failed to process like" },
      { status: 500 }
    );
  }
}
