import { z } from "zod";
import { db } from "@/db";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { and, eq, sql } from "drizzle-orm";
import { getAuthenticatedDbUser } from "@/auth/server";

export async function POST(request: Request) {
  const user = await getAuthenticatedDbUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schema = z.object({
    id: z.string().uuid().refine(id => id !== user.id, {
      message: "Cannot follow yourself"
    }),
  });

  try {
    const body = await request.json();
    const { id } = schema.parse(body);

    const result = await db
      .insert(userToFollow)
      .values({
        userId: user.id,
        followingId: id,
      })
      .onConflictDoUpdate({
        target: [userToFollow.userId, userToFollow.followingId],
        set: {
          deleted: sql`NOT ${userToFollow.deleted}`
        },
        where: and(
          eq(userToFollow.userId, user.id),
          eq(userToFollow.followingId, id)
        )
      })
      .returning({ deleted: userToFollow.deleted });

    const isUnfollow = result[0]?.deleted;
    
    return Response.json({
      message: isUnfollow ? "Unfollowed successfully" : "Followed successfully"
    }, { status: 200 });

  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Invalid request" },
        { status: 400 }
      );
    }
    console.error("Follow error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
