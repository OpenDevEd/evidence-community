import type { LibraryHomeConfig } from "@/config/library-config/schema";
import type { HomeContent, HomeData } from "./HomePage";

/** What a library shows before anyone answers the Home card: only what is true of every library. */
export function defaultContent(name: string): HomeContent {
	return {
		intro: `**${name}** gathers research in one place, so you can search it, read it and cite it. Every publication comes with its details and, where the licence allows, the full text.`,
		involvement: { suggestions: true, editors: false },
	};
}

/** The Home card's answers as the page draws them: a typed step without a title is named after its type, and a step's chosen editor is looked up among the people OpenScholar filled in. */
export function contentFrom(home: LibraryHomeConfig, stepTitles: Record<"arrival" | "check" | "publication", string>): HomeContent {
	const person = (id: string) => home.people.find((entry) => entry.id === id) ?? home.directory.find((entry) => entry.id === id);
	return {
		intro: home.intro,
		curation: {
			text: home.curation.text,
			steps: home.curation.steps.map((step) => {
				const editor = step.editor ? person(step.editor) : undefined;
				return {
					type: step.type,
					title: step.title ?? (step.type === "text" ? "" : stepTitles[step.type]),
					text: step.text ?? "",
					editor: editor && { name: editor.name, photo: editor.photo },
				};
			}),
		},
		team: home.team,
		editors: home.people.map(({ name, title, location, photo }) => ({ name, title, location, photo })),
		questions: home.questions,
		involvement: home.involvement,
		extra: home.extra,
		headings: home.headings,
	};
}

/** A name read inside a sentence: "Teacher training" becomes "teacher training", while "EdTech" or "UNESCO" keep their capitals. */
function inSentence(name: string) {
	return /^\p{Lu}[^\p{Lu}]*$/u.test(name) ? name.toLowerCase() : name;
}

/**
 * The Ask box's three example questions, slot by slot: an owner's question where they wrote one, otherwise one made
 * from the library's topics (its collections when it has none) and the country it studies most. A slot the library
 * has nothing for stays empty. The Home card shows the made ones as placeholders.
 */
export function exampleQuestions(facts: Pick<HomeData, "topics" | "collections" | "countries">, countryName: (code: string) => string, owners: string[] = []) {
	const topics = facts.topics.length > 0 ? facts.topics : facts.collections.map((collection) => ({ name: collection.title }));
	const country = Object.entries(facts.countries).sort((a, b) => b[1] - a[1])[0]?.[0];
	return [
		topics[0] && `What does the evidence say about ${inSentence(topics[0].name)}?`,
		country && `What has been studied in ${countryName(country)}?`,
		topics[1] && `Which approaches to ${inSentence(topics[1].name)} have been tested?`,
	].map((made, index) => owners[index]?.trim() || made || undefined);
}
