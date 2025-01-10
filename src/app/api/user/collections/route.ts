import { z } from "zod";
import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authOptions, auth } from "../../auth/[...nextauth]/config";
import { userCollection } from "@/db/schema/tables/userCollection";
import { fromError } from "zod-validation-error";

export const createCollectionSchema = z.object({
  name: z.string().min(1).max(24),
  private: z.boolean(),
  description: z.string().min(0).max(200).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const validatedData = createCollectionSchema.safeParse(body);

    console.log("validatedData", validatedData);
    
    if (!validatedData.success) {
      return NextResponse.json(
        fromError(validatedData.error).toString(),
        { status: 400 }
      );
    }

    const newCollection = await db.insert(userCollection).values({
      name: validatedData.data.name,
      description: validatedData.data.description,
      private: validatedData.data.private,
      userId: session.user.id,
    }).returning();

    return NextResponse.json(newCollection[0], { status: 201 });
  } catch (error) {
    console.error("Error creating collection:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
