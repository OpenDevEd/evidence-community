import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { PUBLIC_READ_CACHE_CONTROL } from "@/lib/http-cache";

export async function GET(request: NextRequest) {
	return NextResponse.json({ message: "Hello World" }, {
		headers: { "Cache-Control": PUBLIC_READ_CACHE_CONTROL },
	});
}
