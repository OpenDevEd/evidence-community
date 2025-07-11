import { NextRequest, NextResponse } from "next/server";
import meilisearch from "@/lib/meilisearch";

function encodeKey(key: string): string {
	return key.split('').map(char => {
		const code = char.charCodeAt(0);
		return code.toString(36); // Use base36 (0-9 and a-z)
	}).join('n'); // Use 'n' as separator since it's not used in base36
}

function decodeKey(encoded: string): string {
	return encoded.split('n').map(num => {
		const code = parseInt(num, 36);
		return String.fromCharCode(code);
	}).join('');
}

export async function GET(
	request: NextRequest,
	props: { params: Promise<{ key: string }> }
) {

    const params = await props.params;
    const { key: URIkey } = params;

    const key = process.env.MEILI_INDEX + "|" + decodeURIComponent(URIkey);

    const encoding = encodeKey(key);

    try {
        const redirects = await meilisearch.index("redirects").getDocument(encoding);
        return NextResponse.json(redirects);
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Redirect not found" }, { status: 404 });
    }
}