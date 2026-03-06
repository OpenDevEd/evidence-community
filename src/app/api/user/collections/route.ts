import { db } from "@/db";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { userCollection } from "@/db/schema/tables/userCollection";
import { fromError } from "zod-validation-error";
import { getAuthenticatedDbUser } from "@/auth/server";
import { createCollectionSchema } from "./schema";

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedDbUser();
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const validatedData = createCollectionSchema.safeParse(body);
    
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
      userId: user.id,
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
