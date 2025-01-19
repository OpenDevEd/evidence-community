import { NextRequest, NextResponse } from 'next/server';
import { getCachedItem } from '../../../../cache';
import { convertItem } from '@/lib/actions';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ key: string, format: "ris" | "bibtex" }> }
) {
    const params = await props.params;
    const { key, format } = params;

    const result = await getCachedItem(key);

    if (!result || !result.item) {
        return NextResponse.json({
            message: "Item not found"
        }, {
            status: 404
        })
    }

    const converted = await convertItem(result.item, format as "ris" | "bibtex");

    return new Response(converted, {
        headers: {
            "Content-Type": format === "ris" ? "application/x-research-info-systems" : "application/x-bibtex",
            "Content-Disposition": `attachment; filename="${key}.${format}"`
        }
    });
}