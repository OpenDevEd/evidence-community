/**
 * A question asked on another page (the home page's "Ask the library") for the library listing's chat to answer.
 * It waits in this tab's session storage rather than the address, so nothing has to be cleared from the address
 * afterwards and a reload cannot ask it twice.
 */
const KEY = "library-question";

export function handOverQuestion(question: string) {
	sessionStorage.setItem(KEY, question);
}

export function waitingQuestion() {
	return sessionStorage.getItem(KEY);
}

export function forgetWaitingQuestion() {
	sessionStorage.removeItem(KEY);
}
