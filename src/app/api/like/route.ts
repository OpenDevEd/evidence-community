import { db } from "@/db";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import authOptions from "../auth/[...nextauth]/config";
import { usersToLikes } from "@/db/schema/tables/userToLikes";
import { eq, and } from "drizzle-orm";

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

    const existingLike = await db.query.usersToLikes.findFirst({
      where: and(
        eq(usersToLikes.userId, session.user.id),
        eq(usersToLikes.itemKey, itemKey)
      ),
    });

    if (existingLike) {
      await db.delete(usersToLikes)
        .where(
          and(
            eq(usersToLikes.userId, session.user.id),
            eq(usersToLikes.itemKey, itemKey)
          )
        );
      return NextResponse.json({ liked: false });
    }

    await db.insert(usersToLikes).values({
      userId: session.user.id,
      itemKey: itemKey,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({ liked: true });
  } catch (error) {
    console.error("Error handling like:", error);
    return NextResponse.json(
      { error: "Failed to process like" },
      { status: 500 }
    );
  }
}
