import { NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { getDatabaseForConfig } from "@/db";
import { readProfileCollections } from "@/lib/readers/data";
import { pageQuerySchema, parseQuery, READER_RESPONSE_HEADERS, readerError } from "@/lib/readers/http";
import { getSignedInReader } from "@/lib/readers/session";
import { featureUnavailableResponse, getConfigForEnabledFeature } from "@/lib/runtime-feature";

// Without a page, the page the chosen collection is on.
const querySchema = pageQuerySchema.extend({ collectionId: z.string().max(64).optional(), page: z.coerce.number().int().min(1).optional() });

/** A page of a reader's collections as the person asking may see them. Signed out, only the public ones. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
	const config = await getConfigForEnabledFeature("readerAccounts");
	if (!config) return featureUnavailableResponse();
	const query = parseQuery(request, querySchema);
	if (!query.success) return readerError(400, fromError(query.error).toString());
	const [{ id }, viewer] = await Promise.all([props.params, getSignedInReader(request.headers, config)]);
	const page = await readProfileCollections(await getDatabaseForConfig(config), id, viewer?.id ?? null, { ...query.data, chosenId: query.data.collectionId });
	return NextResponse.json(page, { headers: READER_RESPONSE_HEADERS });
}
