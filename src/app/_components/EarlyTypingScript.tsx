/**
 * Words typed into a search box before the page is interactive. A page streams in after its placeholder, which draws
 * the same search box, and the swap puts an untouched box where the typed one was, before React runs. This puts the
 * words and the selection into the box that replaces it, and the focus too when the old box still had it; the box's own
 * component takes the words once React holds it (useEarlyTyping). Only boxes React hasn't taken over yet count, so it
 * never acts once the page is interactive.
 */
export const earlyTypingScript = `
(function () {
	var box = null;
	var typed = "";
	var start = 0;
	var end = 0;
	var owned = false;
	var drawnByReact = function (node) {
		return Object.keys(node).some(function (key) { return key.indexOf("__reactProps") === 0; });
	};
	var note = function (event) {
		var target = event.target;
		if (!(target instanceof HTMLInputElement) || !target.closest('[role="search"]') || drawnByReact(target)) return;
		box = target;
		typed = target.value;
		start = target.selectionStart;
		end = target.selectionEnd;
		owned = true;
	};
	document.addEventListener("input", note, true);
	document.addEventListener("keyup", function (event) { if (event.target === box) note(event); }, true);
	document.addEventListener("pointerup", function (event) { if (event.target === box) note(event); }, true);
	document.addEventListener("focusin", function (event) { owned = event.target === box; }, true);
	new MutationObserver(function () {
		if (!box || box.isConnected) return;
		var next = document.querySelector('[role="search"] input');
		if (!next) return;
		box = null;
		if (next.value !== next.defaultValue || drawnByReact(next)) return;
		next.value = typed;
		var active = document.activeElement;
		if (!owned || (active && active !== document.body)) return;
		next.focus({ preventScroll: true });
		next.setSelectionRange(start, end);
	}).observe(document.documentElement, { childList: true, subtree: true });
})();
`;

/**
 * A plain script, so it runs while the page is read, before any bundle loads. next/script's beforeInteractive waits for
 * Next's own runtime, which can arrive after the first keys.
 */
export default function EarlyTypingScript() {
	return <script id="early-typing" dangerouslySetInnerHTML={{ __html: earlyTypingScript }} />;
}
