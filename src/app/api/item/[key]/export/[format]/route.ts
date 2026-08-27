import { NextRequest, NextResponse } from 'next/server';
import { getCachedItemSmall } from '../../../../cache';
import { convertItem } from '@/lib/actions';
import { getLibraryConfig } from '@/config/library-config/server';
import {
    getLibraryExportContentType,
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
    // Downloads must be on and this format must be switched on. The same pair
    // decides what the download dialog offers.
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
            "Content-Type": getLibraryExportContentType(format),
            "Content-Disposition": `attachment; filename="${key}.${getLibraryExportExtension(format)}"`
        }
    });
}
