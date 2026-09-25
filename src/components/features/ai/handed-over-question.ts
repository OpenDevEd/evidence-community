/**
 * A question asked on another page (the home page's "Ask the library") for the library listing's chat to answer.
 * It waits in this tab's session storage rather than the address, so nothing has to be cleared from the address
 * afterwards and a reload cannot ask it twice.
 */
const KEY = "library-question";
const HANDED_OVER = "library-question-handed-over";

export function handOverQuestion(question: string) {
	sessionStorage.setItem(KEY, question);
	// Next keeps a visited library page alive between visits, so it cannot rely on mounting again to notice.
	window.dispatchEvent(new Event(HANDED_OVER));
}

/** Calls `listener` whenever a question is handed over; returns the function that stops listening. */
export function onQuestionHandedOver(listener: () => void) {
	window.addEventListener(HANDED_OVER, listener);
	return () => window.removeEventListener(HANDED_OVER, listener);
}

export function waitingQuestion() {
	return sessionStorage.getItem(KEY);
}

export function forgetWaitingQuestion() {
	sessionStorage.removeItem(KEY);
}
