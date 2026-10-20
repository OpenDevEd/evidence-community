import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { and, eq, isNull } from "drizzle-orm";
import { outbox } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "../../src/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { createNativeItemDraft, publishItemDraft } from "../../src/lib/admin/native-item-service";
import { removeInstitutionCountry, saveInstitutionCountry } from "../../src/lib/admin/institution-countries";
import { generateSearchProjectionPlans } from "../../src/lib/search-index/projection";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const country = (name: string, countryCode: string) => ({ name, countryCode, openalexId: null, city: null });

it("indexes where a record's authors work, and searches the record again when one of their institutions changes country", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const authorCountry = async (key: string) => {
			const documents = [];
			for await (const plan of generateSearchProjectionPlans(db, config, [{ entityType: "item", entityKey: key }])) documents.push(...plan.documents);
			return documents[0]?.authorCountry;
		};
		const waiting = (key: string) => db.select().from(outbox).where(and(eq(outbox.entityKey, key), isNull(outbox.processedAt)));
		await saveInstitutionCountry(db, country("North University", "KE"));
		await saveInstitutionCountry(db, country("Coast College", "TZ"));
		const created = await createNativeItemDraft(db, {
			itemType: "Report",
			title: "Classrooms",
			creators: [
				// Names fold as the institution list folds them; one with no known country adds none.
				{ creatorType: "author", firstName: "Amina", lastName: "Otieno", institutions: [{ display_name: " north university " }, { display_name: "Unlisted Institute" }] },
				{ creatorType: "author", firstName: "Juma", lastName: "Said", institutions: [{ display_name: "Coast College" }] },
			],
		});
		await publishItemDraft(db, created.itemKey);
		expect(await authorCountry(created.itemKey)).toEqual(["KE", "TZ"]);

		await db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.entityKey, created.itemKey));
		await saveInstitutionCountry(db, country("North University", "UG"));
		expect(await waiting(created.itemKey)).toHaveLength(1);
		expect(await authorCountry(created.itemKey)).toEqual(["TZ", "UG"]);

		await db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.entityKey, created.itemKey));
		await removeInstitutionCountry(db, "Coast College");
		expect(await waiting(created.itemKey)).toHaveLength(1);
		expect(await authorCountry(created.itemKey)).toEqual(["UG"]);
	});
});
