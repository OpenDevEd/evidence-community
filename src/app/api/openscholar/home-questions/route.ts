import { connection, NextRequest, NextResponse } from "next/server";

import { exampleQuestions } from "@/components/pages/home-content";
import { loadQuestionFacts } from "@/components/pages/home-data";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });

/** The example questions the home page makes from the library's topics and countries, slot by slot; OpenScholar's Home card shows them as placeholders. */
export async function GET(request: NextRequest) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		const questions = exampleQuestions(await loadQuestionFacts(), (code) => regionNames.of(code) ?? code);
		return NextResponse.json({ questions: questions.map((question) => question ?? null) }, { headers: ADMIN_RESPONSE_HEADERS });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
