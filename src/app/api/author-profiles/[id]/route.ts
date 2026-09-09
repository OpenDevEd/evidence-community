import { NextResponse } from "next/server";
import { getLibraryConfig } from "@/config/library-config/server";

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
	const {id} = await params;
	if (!/^[a-z0-9]{1,128}$/.test(id)) return NextResponse.json({error: "Invalid author profile"}, {status: 400});
	const config = await getLibraryConfig();
	return NextResponse.redirect(new URL(`/authors/${id}`, config.authentication.openScholar.loginPageUrl), {status: 307, headers: {"Cache-Control": "no-store"}});
}
