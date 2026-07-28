import { NextRequest, NextResponse } from 'next/server';
import { getCachedItemSmall } from '../../../../cache';
import { convertItem } from '@/lib/actions';
import { getLibraryConfig } from '@/config/library-config/server';
import {
    getLibraryExportExtension,
    isBibliographicExportFormat,
} from '@/config/library-config/exports';

export async function GET(
    request: NextRequest,
    props: { params: Promise<{ key: string, format: "ris" | "bibtex" }> }
) {
    const params = await props.params;
    const { key, format } = params;
    if (!isBibliographicExportFormat(format)) {
        return NextResponse.json(
            { message: "Export format not found" },
            { status: 404 },
        );
    }

    const config = await getLibraryConfig();
    if (!config.features.downloads || !config.exports[format]) {
        return NextResponse.json(
            { message: "Export format not available" },
            { status: 404 },
        );
    }

    const result = await getCachedItemSmall(key);

    if (!result || !result.item) {
        return NextResponse.json({
            message: "Item not found"
        }, {
            status: 404
        })
    }

    const converted = await convertItem(result.item, format);

    return new Response(converted, {
        headers: {
            "Content-Type": format === "ris" ? "application/x-research-info-systems" : "application/x-bibtex",
            "Content-Disposition": `attachment; filename="${key}.${getLibraryExportExtension(format)}"`
        }
    });
}
