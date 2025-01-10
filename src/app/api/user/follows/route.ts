import { z } from "zod";
import { db } from "@/db";
import { authOptions, auth } from "@/app/api/auth/[...nextauth]/config";
import { userToFollow } from "@/db/schema/tables/userToFollow";
import { and, eq, sql } from "drizzle-orm";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const schema = z.object({
    id: z.string().uuid().refine(id => id !== session.user.id, {
      message: "Cannot follow yourself"
    }),
  });

  try {
    const body = await request.json();
    const { id } = schema.parse(body);

    const result = await db
      .insert(userToFollow)
      .values({
        userId: session.user.id,
        followingId: id,
      })
      .onConflictDoUpdate({
        target: [userToFollow.userId, userToFollow.followingId],
        set: {
          deleted: sql`NOT ${userToFollow.deleted}`
        },
        where: and(
          eq(userToFollow.userId, session.user.id),
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
      return Response.json({ error: error.errors[0].message }, { status: 400 });
    }
    console.error("Follow error:", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}