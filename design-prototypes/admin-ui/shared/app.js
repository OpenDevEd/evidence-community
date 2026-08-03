/*
 * Shared functional model for every variation.
 *
 * - Store: items (published snapshot + itemDraft-style draft with
 *   draftRevision/baseRevision), attachments as child items with
 *   itemFileDraft/itemFilePublication state, hierarchical collections,
 *   source connections. Persisted to localStorage for the session;
 *   "Reset demo" reseeds.
 * - Lifecycle mirrors native-item-service.ts / native-file-service.ts:
 *   publish applies the draft snapshot and bumps the canonical revision,
 *   unpublish tombstones, a stale draft (baseRevision != revision) blocks
 *   publish, a published PDF blocks attachment-metadata unpublish, PDF
 *   publish requires published attachment + published parent.
 * - Component renderers (Proto.C.*) return HTML strings; pages compose
 *   them into their own layouts. All behavior is event-delegated here.
 *
 * data-* protocol:
 *   [data-act="…"] [data-key="…"] [data-arg="…"]  → actions (click)
 *   [data-bind="KEY|path"]                        → draft field binding
 *   [data-select="KEY"], [data-sort="col"], [data-bulk="KEY"]
 *   [data-tag-input="KEY"], [data-coll-filter="CTX"]
 */
window.Proto = (function () {
	const SEED = window.ProtoData;
	const I = window.ProtoIcons;
	const LS_KEY = "el-admin-proto-v3";
	const KEY_ALPHABET = "23456789ABCDEFGHIJKLMNPQRSTUVWXYZ";

	/* ================= state ================= */

	function clone(value) { return JSON.parse(JSON.stringify(value)); }

	function seed() {
		return clone({ items: SEED.items, collections: SEED.collections });
	}

	function load() {
		try {
			const raw = localStorage.getItem(LS_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed || !Array.isArray(parsed.items)) return null;
			/* uploads do not survive a reload: mark them interrupted */
			parsed.items.forEach((it) => {
				const fd = it.fileDraft;
				if (fd && (fd.status === "uploading" || fd.status === "processing")) {
					fd.status = "error";
					fd.error = "Upload interrupted by reload";
				}
			});
			return parsed;
		} catch (err) { return null; }
	}

	let data = load() || seed();

	function save() {
		try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (err) { /* full/blocked */ }
	}

	const ui = {
		query: "", source: "all", type: "all", state: "all", file: "all",
		collection: "all", sort: { key: "modified", dir: -1 },
		selected: null, bulk: {},
		collQuery: {},          /* per-context checklist filter text */
	};

	const listeners = [];
	function subscribe(fn) { listeners.push(fn); }
	function emit() { listeners.forEach((fn) => fn()); }

	/* ================= helpers ================= */

	function esc(value) {
		return String(value == null ? "" : value)
			.replace(/&/g, "&amp;").replace(/</g, "&lt;")
			.replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	}

	function pad(n) { return String(n).padStart(2, "0"); }
	function nowStamp() {
		const d = new Date();
		return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
			" " + pad(d.getHours()) + ":" + pad(d.getMinutes());
	}
	function today() { return nowStamp().slice(0, 10); }

	function mintKey() {
		let key;
		do {
			key = "";
			for (let i = 0; i < 8; i += 1) {
				key += KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)];
			}
		} while (data.items.some((it) => it.key === key) ||
			data.collections.some((c) => c.key === key));
		return key;
	}

	function fakeSha(text) {
		let h1 = 0x811c9dc5;
		let out = "";
		const src = text + "|" + text.length;
		for (let round = 0; round < 8; round += 1) {
			for (let i = 0; i < src.length; i += 1) {
				h1 ^= src.charCodeAt(i) + round;
				h1 = Math.imul(h1, 0x01000193) >>> 0;
			}
			out += h1.toString(16).padStart(8, "0");
		}
		return out.slice(0, 64);
	}

	function typeLabel(itemType) {
		return String(itemType || "").replace(/([a-z])([A-Z])/g, "$1 $2");
	}

	function byKey(key) { return data.items.find((it) => it.key === key) || null; }
	function collByKey(key) { return data.collections.find((c) => c.key === key) || null; }
	function srcOf(it) { return SEED.sources.find((s) => s.key === it.sourceKey) || SEED.sources[0]; }
	function readOnly(it) { return srcOf(it).readOnly; }

	function effective(it) {
		return it.draft ? it.draft.payload : (it.published || emptyPayload(it.itemType));
	}
	function emptyPayload(itemType) {
		return { itemType: itemType, title: "", abstractNote: "", creators: [], tags: [], collections: [], fields: {} };
	}

	function titleOf(it) {
		const t = (effective(it).title || "").trim();
		return t || "Untitled";
	}

	function stateOf(it) {
		if (it.deleted) return "deleted";
		if (!it.published && it.draft) return "draft";
		if (it.published && it.draft) return "edited";
		if (it.published) return "published";
		return "draft";
	}
	const STATE_LABEL = { draft: "Draft", edited: "Edited", published: "Published", deleted: "Deleted" };

	function creatorName(c) {
		if (c.name) return c.name;
		return [c.lastName, c.firstName].filter(Boolean).join(", ");
	}
	function creatorsLine(it, max) {
		max = max || 3;
		const names = (effective(it).creators || [])
			.map((c) => c.name ? c.name : (c.lastName || "")).filter(Boolean);
		if (!names.length) return "";
		if (names.length <= max) return names.join("; ");
		return names.slice(0, max).join("; ") + " et al.";
	}
	function year(it) { return ((effective(it).fields || {}).date || "").slice(0, 4); }
	function venue(it) {
		const f = effective(it).fields || {};
		return f.publicationTitle || f.institution || f.proceedingsTitle ||
			f.publisher || f.repository || f.university || f.websiteTitle ||
			f.meetingName || f.blogTitle || "";
	}

	function topItems() { return data.items.filter((it) => !it.parentItem); }
	function childrenOf(key) { return data.items.filter((it) => it.parentItem === key); }
	function selected() { return byKey(ui.selected) || null; }

	function activeCollections() { return data.collections.filter((c) => !c.deleted); }
	function collChildren(parentKey, includeDeleted) {
		return data.collections.filter((c) =>
			(c.parentCollection || null) === (parentKey || null) &&
			(includeDeleted || !c.deleted));
	}
	function collDescendants(key) {
		const out = [];
		const walk = (parent) => {
			data.collections.forEach((c) => {
				if (c.parentCollection === parent) { out.push(c.key); walk(c.key); }
			});
		};
		walk(key);
		return out;
	}
	function collPath(key) {
		const parts = [];
		let node = collByKey(key);
		let hops = 0;
		while (node && hops < 8) {
			parts.unshift(node.name);
			node = node.parentCollection ? collByKey(node.parentCollection) : null;
			hops += 1;
		}
		return parts.join(" / ");
	}

	function fileSummary(it) {
		const kids = childrenOf(it.key).filter((k) => !k.deleted);
		if (!kids.length) return "none";
		if (kids.some((k) => k.filePublication)) return "published";
		if (kids.some((k) => k.fileDraft && k.fileDraft.status === "error")) return "error";
		if (kids.some((k) => k.fileDraft)) return "staged";
		return "none";
	}
	const FILE_FILTER_LABEL = {
		all: "Any PDF state", published: "PDF published",
		staged: "PDF staged", error: "PDF failed", none: "No PDF",
	};

	/* ================= filtering / sorting ================= */

	function filtered() {
		const q = ui.query.trim().toLowerCase();
		const collScope = ui.collection !== "all"
			? [ui.collection].concat(collDescendants(ui.collection))
			: null;
		const out = topItems().filter((it) => {
			const st = stateOf(it);
			if (ui.state === "all" && st === "deleted") return false;
			if (ui.state !== "all" && st !== ui.state) return false;
			if (ui.source !== "all" && it.sourceKey !== ui.source) return false;
			const p = effective(it);
			if (ui.type !== "all" && p.itemType !== ui.type) return false;
			if (ui.file !== "all" && fileSummary(it) !== ui.file) return false;
			if (collScope && !(p.collections || []).some((c) => collScope.includes(c))) return false;
			if (q) {
				const hay = [
					p.title, creatorsLine(it, 99), venue(it),
					(p.fields || {}).DOI, (p.tags || []).join(" "), it.key,
				].join(" ").toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});

		const { key, dir } = ui.sort;
		function val(it) {
			switch (key) {
				case "title": return titleOf(it).toLowerCase();
				case "creators": return creatorsLine(it, 1).toLowerCase();
				case "year": return (effective(it).fields || {}).date || "";
				case "type": return effective(it).itemType;
				case "key": return it.key;
				case "state": return stateOf(it);
				case "file": return fileSummary(it);
				default: return it.dateModified || "";
			}
		}
		out.sort((a, b) => {
			const va = val(a); const vb = val(b);
			return va < vb ? -dir : va > vb ? dir : 0;
		});
		return out;
	}

	/* ================= toast / modal ================= */

	let toastTimer = null;
	function toast(message) {
		document.querySelectorAll(".proto-toast").forEach((el) => el.remove());
		const el = document.createElement("div");
		el.className = "proto-toast";
		el.setAttribute("role", "status");
		el.textContent = message;
		document.body.appendChild(el);
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => el.remove(), 2800);
	}

	let modalSubmit = null;
	function openModal(title, bodyHTML, opts) {
		opts = opts || {};
		closeModal();
		const wrap = document.createElement("div");
		wrap.className = "proto-modal-wrap";
		wrap.innerHTML =
			'<div class="proto-modal-scrim" data-act="modal-close"></div>' +
			'<div class="proto-modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">' +
				'<div class="pm-head"><h3>' + esc(title) + "</h3>" +
					iconBtn("modal-close", "x", "Close") + "</div>" +
				'<div class="pm-body">' + bodyHTML + "</div>" +
				(opts.actions
					? '<div class="pm-foot">' + opts.actions + "</div>"
					: "") +
			"</div>";
		document.body.appendChild(wrap);
		modalSubmit = opts.onSubmit || null;
		const focusTarget = wrap.querySelector("[autofocus]") ||
			wrap.querySelector("input, select, textarea, button:not([data-act='modal-close'])");
		if (focusTarget) focusTarget.focus();
	}
	function closeModal() {
		document.querySelectorAll(".proto-modal-wrap").forEach((el) => el.remove());
		modalSubmit = null;
	}
	function modalValue(name) {
		const el = document.querySelector(".proto-modal [name='" + name + "']");
		if (!el) return "";
		if (el.type === "checkbox") return el.checked;
		return el.value;
	}

	function confirmAction(message, confirmLabel, onYes, danger) {
		openModal("Confirm", '<p class="pm-text">' + esc(message) + "</p>", {
			actions:
				btnHTML("modal-close", "Cancel", { ghost: true }) +
				btnHTML("modal-confirm", confirmLabel, { primary: !danger, danger: danger }),
			onSubmit: onYes,
		});
	}

	/* ================= draft machinery ================= */

	function ensureDraft(it) {
		if (readOnly(it)) return null;
		if (!it.draft) {
			it.draft = {
				payload: it.published ? clone(it.published) : emptyPayload(it.itemType),
				draftRevision: 1,
				baseRevision: it.revision,
				savedAt: null,
			};
		}
		return it.draft;
	}

	const saveTimers = {};
	function scheduleAutosave(it) {
		setAutosaveText(it.key, "Saving…");
		clearTimeout(saveTimers[it.key]);
		saveTimers[it.key] = setTimeout(() => commitDraft(it, true), 700);
	}
	function commitDraft(it, silent) {
		clearTimeout(saveTimers[it.key]);
		if (!it.draft) return;
		it.draft.draftRevision += 1;
		it.draft.savedAt = nowStamp();
		it.dateModified = today();
		save();
		setAutosaveText(it.key, "Saved, draft revision " + it.draft.draftRevision);
		echo(it);
		if (!silent) { emit(); toast("Draft saved"); }
	}
	function setAutosaveText(key, text) {
		document.querySelectorAll('[data-autosave="' + key + '"]').forEach((el) => {
			el.textContent = text;
		});
	}
	/* update list titles / headings live without a focus-destroying render */
	function echo(it) {
		const t = titleOf(it);
		document.querySelectorAll('[data-echo-title="' + it.key + '"]').forEach((el) => {
			el.textContent = t;
		});
	}

	function setDraftValue(it, path, value) {
		const draft = ensureDraft(it);
		if (!draft) return;
		const p = draft.payload;
		if (path === "title") p.title = value;
		else if (path === "abstractNote") p.abstractNote = value;
		else if (path.startsWith("field:")) p.fields[path.slice(6)] = value;
		else if (path.startsWith("creator:")) {
			const bits = path.split(":");
			const c = p.creators[Number(bits[1])];
			if (c) c[bits[2]] = value;
		}
		scheduleAutosave(it);
	}

	function changeItemType(it, newType) {
		const draft = ensureDraft(it);
		if (!draft) return;
		draft.payload.itemType = newType;
		const allowedRoles = SEED.rolesForType(newType);
		draft.payload.creators.forEach((c) => {
			if (!allowedRoles.includes(c.creatorType)) c.creatorType = allowedRoles[0];
		});
		commitDraft(it, true);
		emit();
	}

	/* ================= validation ================= */

	function validateDraft(it) {
		const errors = [];
		const p = it.draft.payload;
		if (p.itemType !== "Attachment" && !(p.title || "").trim()) {
			errors.push({ field: "title", message: "A title is required to publish." });
		}
		const roles = SEED.rolesForType(p.itemType);
		(p.creators || []).forEach((c, i) => {
			const single = Boolean((c.name || "").trim());
			const split = Boolean((c.firstName || "").trim()) || Boolean((c.lastName || "").trim());
			if (single === split) {
				errors.push({ field: "creator:" + i, message: "Creator " + (i + 1) + " needs either a single name or a first/last name." });
			}
			if (p.itemType !== "Attachment" && !roles.includes(c.creatorType)) {
				errors.push({ field: "creator:" + i, message: c.creatorType + " is not a valid role for " + typeLabel(p.itemType) + "." });
			}
		});
		if (p.itemType === "Attachment") {
			const parent = byKey(it.parentItem);
			if (!parent) errors.push({ field: "parent", message: "Attachment needs a parent record." });
		}
		return errors;
	}

	/* ================= lifecycle actions ================= */

	function pushHistory(it, event, detail) {
		it.history = it.history || [];
		it.history.push({ at: nowStamp(), event: event, detail: detail || "" });
	}

	function createItem(itemType, parentKey) {
		const key = mintKey();
		const item = {
			key: key, sourceKey: "native", sourceRecordKey: key,
			itemType: itemType, parentItem: parentKey || null,
			revision: 0, deleted: false,
			dateAdded: today(), dateModified: today(),
			published: null,
			draft: {
				payload: emptyPayload(itemType),
				draftRevision: 1, baseRevision: 0, savedAt: null,
			},
			history: [{ at: nowStamp(), event: parentKey ? "Attachment created" : "Created" }],
		};
		if (parentKey) {
			item.draft.payload.title = "PDF attachment";
			item.fileDraft = null;
			item.filePublication = null;
		}
		data.items.push(item);
		if (!parentKey) { ui.selected = key; }
		save(); emit();
		return item;
	}

	function duplicateItem(it) {
		const key = mintKey();
		const payload = clone(effective(it));
		const copy = {
			key: key, sourceKey: "native", sourceRecordKey: key,
			itemType: payload.itemType, parentItem: null,
			revision: 0, deleted: false,
			dateAdded: today(), dateModified: today(),
			published: null,
			draft: { payload: payload, draftRevision: 1, baseRevision: 0, savedAt: null },
			history: [{ at: nowStamp(), event: "Duplicated from " + it.key }],
		};
		data.items.push(copy);
		ui.selected = key;
		save(); emit();
		toast("Duplicated as a native draft");
	}

	function publishItem(it) {
		if (readOnly(it) || !it.draft) return;
		if (it.draft.baseRevision !== it.revision) {
			toast("Draft is stale, rebase it first");
			return;
		}
		const errors = validateDraft(it);
		if (errors.length) {
			it.draftErrors = errors;
			emit();
			toast("Fix the validation issues to publish");
			return;
		}
		delete it.draftErrors;
		it.published = clone(it.draft.payload);
		it.revision += 1;
		const wasDeleted = it.deleted;
		it.deleted = false;
		it.deletedAt = null;
		it.dateModified = today();
		it.draft = null;
		pushHistory(it, wasDeleted ? "Restored and published" : "Published", "revision " + it.revision);
		const parent = it.parentItem ? byKey(it.parentItem) : null;
		if (parent) {
			parent.revision += 1;
			pushHistory(parent, "Attachment published", titleOf(it));
		}
		save(); emit();
		toast("Published, revision " + it.revision);
	}

	function unpublishItem(it) {
		if (readOnly(it)) return;
		if (it.deleted) return; /* idempotent */
		if (it.itemType === "Attachment" && it.filePublication) {
			toast("Unpublish the PDF first");
			return;
		}
		it.deleted = true;
		it.deletedAt = today();
		it.revision += 1;
		it.dateModified = today();
		pushHistory(it, "Unpublished", "tombstoned, revision " + it.revision);
		const parent = it.parentItem ? byKey(it.parentItem) : null;
		if (parent) {
			parent.revision += 1;
			pushHistory(parent, "Attachment unpublished", titleOf(it));
		}
		save(); emit();
		toast("Unpublished");
	}

	function restoreItem(it) {
		if (readOnly(it) || !it.deleted) return;
		ensureDraft(it);
		publishItem(it);
	}

	function discardDraft(it) {
		if (!it.draft) return;
		if (!it.published) {
			/* never published: discard releases the identity */
			const kids = childrenOf(it.key);
			if (kids.length) {
				toast("Remove its attachments first");
				return;
			}
			data.items = data.items.filter((cand) => cand.key !== it.key);
			if (ui.selected === it.key) {
				const first = topItems().filter((cand) => !cand.deleted)[0];
				ui.selected = first ? first.key : null;
			}
			save(); emit();
			toast("Draft deleted");
			return;
		}
		it.draft = null;
		delete it.draftErrors;
		save(); emit();
		toast("Draft discarded");
	}

	function rebaseDraft(it) {
		if (!it.draft) return;
		it.draft.baseRevision = it.revision;
		pushHistory(it, "Draft rebased", "onto revision " + it.revision);
		save(); emit();
		toast("Draft rebased onto revision " + it.revision);
	}

	/* ---- creators / tags ---- */

	function addCreator(it) {
		const draft = ensureDraft(it);
		if (!draft) return;
		const roles = SEED.rolesForType(draft.payload.itemType);
		draft.payload.creators.push({ creatorType: roles[0], firstName: "", lastName: "" });
		commitDraft(it, true); emit();
	}
	function removeCreator(it, index) {
		const draft = ensureDraft(it);
		if (!draft) return;
		draft.payload.creators.splice(index, 1);
		commitDraft(it, true); emit();
	}
	function moveCreator(it, index, dir) {
		const draft = ensureDraft(it);
		if (!draft) return;
		const list = draft.payload.creators;
		const target = index + dir;
		if (target < 0 || target >= list.length) return;
		const tmp = list[index];
		list[index] = list[target];
		list[target] = tmp;
		commitDraft(it, true); emit();
	}
	function toggleCreatorMode(it, index) {
		const draft = ensureDraft(it);
		if (!draft) return;
		const c = draft.payload.creators[index];
		if (!c) return;
		if (c.name !== undefined) {
			const parts = (c.name || "").split(/,\s*/);
			delete c.name;
			c.lastName = parts[0] || "";
			c.firstName = parts[1] || "";
		} else {
			c.name = [c.lastName, c.firstName].filter(Boolean).join(", ");
			delete c.firstName;
			delete c.lastName;
		}
		commitDraft(it, true); emit();
	}

	function addTag(it, name) {
		const value = (name || "").trim();
		if (!value) return;
		const draft = ensureDraft(it);
		if (!draft) return;
		if (draft.payload.tags.includes(value)) { toast("Tag already present"); return; }
		draft.payload.tags.push(value);
		commitDraft(it, true); emit();
	}
	function removeTag(it, name) {
		const draft = ensureDraft(it);
		if (!draft) return;
		draft.payload.tags = draft.payload.tags.filter((t) => t !== name);
		commitDraft(it, true); emit();
	}

	/* ---- collection membership ---- */

	function membershipOf(it) { return effective(it).collections || []; }

	function toggleMembership(it, collKey) {
		const coll = collByKey(collKey);
		if (!coll) return;
		if (readOnly(it)) {
			/* imported record: only native curated collections are editable */
			if (coll.sourceKey !== "native") { toast("Managed by source sync"); return; }
			const list = it.published.collections;
			const idx = list.indexOf(collKey);
			if (idx >= 0) list.splice(idx, 1); else list.push(collKey);
			it.revision += 1;
			pushHistory(it, idx >= 0 ? "Removed from collection" : "Added to collection", coll.name);
			save(); emit();
			return;
		}
		const draft = ensureDraft(it);
		const list = draft.payload.collections;
		const idx = list.indexOf(collKey);
		if (idx >= 0) list.splice(idx, 1); else list.push(collKey);
		commitDraft(it, true); emit();
	}

	/* ---- attachment file lifecycle ---- */

	const fileTimers = {};
	function clearFileTimer(key) {
		if (fileTimers[key]) { clearInterval(fileTimers[key]); clearTimeout(fileTimers[key]); delete fileTimers[key]; }
	}

	function stageFile(att, name, size) {
		if (!name.toLowerCase().endsWith(".pdf")) { toast("Only PDF files are accepted"); return; }
		clearFileTimer(att.key);
		const prevRev = Math.max(
			att.fileDraft ? att.fileDraft.uploadRevision : 0,
			att.filePublication ? att.filePublication.uploadRevision : 0,
		);
		att.fileDraft = {
			uploadRevision: prevRev + 1,
			filename: name, sizeBytes: size,
			status: "uploading", progress: 0,
			sha256: null, pageCount: null, textExtracted: false,
		};
		pushHistory(att, "PDF upload started", name + ", upload revision " + (prevRev + 1));
		save(); emit();
		fileTimers[att.key] = setInterval(() => {
			const fd = att.fileDraft;
			if (!fd || fd.status !== "uploading") { clearFileTimer(att.key); return; }
			fd.progress = Math.min(100, fd.progress + 9 + Math.floor(Math.random() * 9));
			document.querySelectorAll('[data-upload-progress="' + att.key + '"]').forEach((el) => {
				el.style.width = fd.progress + "%";
			});
			document.querySelectorAll('[data-upload-pct="' + att.key + '"]').forEach((el) => {
				el.textContent = fd.progress + "%";
			});
			if (fd.progress >= 100) {
				clearFileTimer(att.key);
				fd.status = "processing";
				save(); emit();
				fileTimers[att.key] = setTimeout(() => finishProcessing(att), 1100);
			}
		}, 170);
	}

	function finishProcessing(att) {
		clearFileTimer(att.key);
		const fd = att.fileDraft;
		if (!fd) return;
		if (fd.filename.toLowerCase().includes("broken")) {
			fd.status = "error";
			fd.error = "Uploaded PDF does not match its declared size and SHA-256";
			pushHistory(att, "PDF verification failed", "upload revision " + fd.uploadRevision);
		} else {
			fd.status = "ready";
			fd.sha256 = fakeSha(fd.filename + fd.sizeBytes);
			fd.pageCount = 4 + (fd.sizeBytes % 53);
			fd.textExtracted = true;
			fd.coverFrom = "#2f2450";
			fd.coverTo = "#141021";
			pushHistory(att, "PDF verified and processed",
				fd.pageCount + " pages, upload revision " + fd.uploadRevision);
		}
		save(); emit();
	}

	function retryFile(att) {
		const fd = att.fileDraft;
		if (!fd || fd.status !== "error") return;
		fd.status = "processing";
		delete fd.error;
		/* a retry re-verifies the staged object; give it a clean name */
		fd.filename = fd.filename.replace(/broken[-_]?/i, "");
		save(); emit();
		fileTimers[att.key] = setTimeout(() => finishProcessing(att), 1100);
	}

	function removeStagedFile(att) {
		clearFileTimer(att.key);
		att.fileDraft = null;
		pushHistory(att, "Staged PDF removed");
		save(); emit();
	}

	function fileGuard(att) {
		const fd = att.fileDraft;
		if (!fd || fd.status !== "ready") return "The staged PDF must finish verification first";
		if (!att.published || att.deleted) return "Publish the attachment metadata first";
		const parent = byKey(att.parentItem);
		if (!parent || !parent.published || parent.deleted) return "Publish the parent record first";
		return null;
	}

	function publishFile(att) {
		const guard = fileGuard(att);
		if (guard) { toast(guard); return; }
		const fd = att.fileDraft;
		att.filePublication = {
			uploadRevision: fd.uploadRevision,
			filename: fd.filename, sizeBytes: fd.sizeBytes,
			sha256: fd.sha256, pageCount: fd.pageCount,
			publishedAt: today(),
			publicUrl: "https://files.example.org/native/" + att.key + "/" +
				fd.sha256.slice(0, 8) + "/file.pdf",
			coverFrom: fd.coverFrom || "#2f2450", coverTo: fd.coverTo || "#141021",
		};
		att.fileDraft = null;
		att.revision += 1;
		pushHistory(att, "PDF published", fd.filename);
		const parent = byKey(att.parentItem);
		if (parent) {
			parent.revision += 1;
			pushHistory(parent, "PDF published", fd.filename);
		}
		save(); emit();
		toast("PDF published");
	}

	function unpublishFile(att) {
		if (!att.filePublication) return;
		const name = att.filePublication.filename;
		att.filePublication = null;
		att.revision += 1;
		pushHistory(att, "PDF unpublished", name);
		const parent = byKey(att.parentItem);
		if (parent) {
			parent.revision += 1;
			pushHistory(parent, "PDF unpublished", name);
		}
		save(); emit();
		toast("PDF unpublished, metadata kept");
	}

	/* ---- collection admin ---- */

	function collEditable(coll) { return coll.sourceKey === "native"; }

	function createCollection(parentKey) {
		const parent = parentKey ? collByKey(parentKey) : null;
		if (parent && !collEditable(parent)) { toast("Managed by source sync"); return; }
		openModal(parent ? "New collection in " + parent.name : "New collection",
			'<label class="pm-label">Name<input name="name" autofocus></label>' +
			'<label class="pm-label">Description<textarea name="description" rows="2"></textarea></label>' +
			'<label class="pm-check"><input type="checkbox" name="published" checked> Visible on the public site</label>',
			{
				actions: btnHTML("modal-close", "Cancel", { ghost: true }) +
					btnHTML("modal-confirm", "Create", { primary: true }),
				onSubmit: function () {
					const name = String(modalValue("name")).trim();
					if (!name) { toast("A name is required"); return false; }
					data.collections.push({
						key: mintKey(), sourceKey: "native", name: name,
						parentCollection: parentKey || null,
						description: String(modalValue("description")).trim(),
						visibility: modalValue("published") ? "published" : "private",
						deleted: false, revision: 1,
					});
					save(); emit();
					toast("Collection created");
					return true;
				},
			});
	}

	function editCollection(coll) {
		if (!collEditable(coll)) { toast("Managed by source sync"); return; }
		openModal("Edit collection",
			'<label class="pm-label">Name<input name="name" value="' + esc(coll.name) + '" autofocus></label>' +
			'<label class="pm-label">Description<textarea name="description" rows="2">' + esc(coll.description || "") + "</textarea></label>" +
			'<label class="pm-check"><input type="checkbox" name="published"' + (coll.visibility === "published" ? " checked" : "") + "> Visible on the public site</label>",
			{
				actions: btnHTML("modal-close", "Cancel", { ghost: true }) +
					btnHTML("modal-confirm", "Save", { primary: true }),
				onSubmit: function () {
					const name = String(modalValue("name")).trim();
					if (!name) { toast("A name is required"); return false; }
					coll.name = name;
					coll.description = String(modalValue("description")).trim();
					coll.visibility = modalValue("published") ? "published" : "private";
					coll.revision += 1;
					save(); emit();
					return true;
				},
			});
	}

	function moveCollection(coll) {
		if (!collEditable(coll)) { toast("Managed by source sync"); return; }
		const blocked = [coll.key].concat(collDescendants(coll.key));
		const options = activeCollections()
			.filter((c) => c.sourceKey === "native" && !blocked.includes(c.key))
			.map((c) => '<option value="' + c.key + '"' +
				(coll.parentCollection === c.key ? " selected" : "") + ">" +
				esc(collPath(c.key)) + "</option>").join("");
		openModal("Move " + coll.name,
			'<label class="pm-label">New parent<select name="parent" autofocus>' +
				'<option value="">Library root</option>' + options + "</select></label>",
			{
				actions: btnHTML("modal-close", "Cancel", { ghost: true }) +
					btnHTML("modal-confirm", "Move", { primary: true }),
				onSubmit: function () {
					coll.parentCollection = String(modalValue("parent")) || null;
					coll.revision += 1;
					save(); emit();
					toast("Collection moved");
					return true;
				},
			});
	}

	function deleteCollection(coll) {
		if (!collEditable(coll)) { toast("Managed by source sync"); return; }
		if (collChildren(coll.key).length) { toast("Move or delete its child collections first"); return; }
		confirmAction(
			'Delete the collection "' + coll.name + '"? Items keep their other memberships.',
			"Delete",
			function () {
				coll.deleted = true;
				coll.revision += 1;
				save(); emit();
				toast("Collection deleted");
				return true;
			},
			true,
		);
	}

	function restoreCollection(coll) {
		coll.deleted = false;
		/* a restored child under a deleted parent moves to the root */
		if (coll.parentCollection) {
			const parent = collByKey(coll.parentCollection);
			if (!parent || parent.deleted) coll.parentCollection = null;
		}
		coll.revision += 1;
		save(); emit();
		toast("Collection restored");
	}

	/* ---- bulk ---- */

	function bulkKeys() { return Object.keys(ui.bulk).filter((k) => ui.bulk[k]); }
	function bulkClear() { ui.bulk = {}; emit(); }
	function bulkToggle(key) { ui.bulk[key] = !ui.bulk[key]; emit(); }

	function bulkCollectionModal(mode) {
		const keys = bulkKeys();
		if (!keys.length) return;
		const options = activeCollections().map((c) =>
			'<option value="' + c.key + '">' + esc(collPath(c.key)) +
			(c.sourceKey === "native" ? "" : " (" + esc(srcLabel(c.sourceKey)) + ")") +
			"</option>").join("");
		openModal(mode === "add" ? "Add selection to collection" : "Remove selection from collection",
			'<label class="pm-label">Collection<select name="coll" autofocus>' + options + "</select></label>",
			{
				actions: btnHTML("modal-close", "Cancel", { ghost: true }) +
					btnHTML("modal-confirm", mode === "add" ? "Add" : "Remove", { primary: true }),
				onSubmit: function () {
					const collKey = String(modalValue("coll"));
					const coll = collByKey(collKey);
					let changed = 0; let skipped = 0;
					keys.forEach((key) => {
						const it = byKey(key);
						if (!it) return;
						const member = membershipOf(it).includes(collKey);
						if (mode === "add" ? member : !member) return;
						if (readOnly(it) && coll.sourceKey !== "native") { skipped += 1; return; }
						toggleMembership(it, collKey);
						changed += 1;
					});
					toast((mode === "add" ? "Added " : "Removed ") + changed +
						(changed === 1 ? " item" : " items") +
						(skipped ? ", " + skipped + " skipped (source-managed)" : ""));
					return true;
				},
			});
	}

	function bulkPublish() {
		let done = 0; let skipped = 0;
		bulkKeys().forEach((key) => {
			const it = byKey(key);
			if (!it || readOnly(it) || !it.draft) { skipped += 1; return; }
			if (it.draft.baseRevision !== it.revision || validateDraft(it).length) { skipped += 1; return; }
			delete it.draftErrors;
			it.published = clone(it.draft.payload);
			it.revision += 1;
			it.deleted = false;
			it.draft = null;
			it.dateModified = today();
			pushHistory(it, "Published", "revision " + it.revision + ", bulk action");
			done += 1;
		});
		save(); emit();
		toast("Published " + done + (skipped ? ", skipped " + skipped : ""));
	}

	function bulkDelete() {
		const keys = bulkKeys();
		if (!keys.length) return;
		confirmAction("Unpublish " + keys.length + (keys.length === 1 ? " item?" : " items?") +
			" They stay recoverable as deleted records.", "Unpublish", function () {
			let done = 0; let skipped = 0;
			keys.forEach((key) => {
				const it = byKey(key);
				if (!it || readOnly(it) || it.deleted) { skipped += 1; return; }
				it.deleted = true;
				it.deletedAt = today();
				it.revision += 1;
				pushHistory(it, "Unpublished", "bulk action, revision " + it.revision);
				done += 1;
			});
			ui.bulk = {};
			save(); emit();
			toast("Unpublished " + done + (skipped ? ", skipped " + skipped : ""));
			return true;
		}, true);
	}

	function srcLabel(key) {
		const s = SEED.sources.find((cand) => cand.key === key);
		return s ? s.label : key;
	}

	function resetDemo() {
		confirmAction("Reset the demo data? All local changes are discarded.", "Reset", function () {
			localStorage.removeItem(LS_KEY);
			location.reload();
			return true;
		}, true);
	}

	/* ================= shared renderers ================= */

	function icon(name) { return I[name] || ""; }

	function iconBtn(act, iconName, label, opts) {
		opts = opts || {};
		return '<button class="ibtn' + (opts.danger ? " ibtn--danger" : "") + '"' +
			' data-act="' + act + '"' +
			(opts.key ? ' data-key="' + opts.key + '"' : "") +
			(opts.arg !== undefined ? ' data-arg="' + esc(opts.arg) + '"' : "") +
			(opts.disabled ? " disabled" : "") +
			' aria-label="' + esc(label) + '" title="' + esc(opts.title || label) + '">' +
			icon(iconName) + "</button>";
	}

	function btnHTML(act, label, opts) {
		opts = opts || {};
		return '<button class="btn' +
			(opts.primary ? " btn--primary" : "") +
			(opts.ghost ? " btn--ghost" : "") +
			(opts.danger ? " btn--danger" : "") + '"' +
			' data-act="' + act + '"' +
			(opts.key ? ' data-key="' + opts.key + '"' : "") +
			(opts.arg !== undefined ? ' data-arg="' + esc(opts.arg) + '"' : "") +
			(opts.disabled ? ' disabled title="' + esc(opts.title || "") + '"' : (opts.title ? ' title="' + esc(opts.title) + '"' : "")) +
			">" + (opts.icon ? icon(opts.icon) : "") + "<span>" + esc(label) + "</span></button>";
	}

	function stateTag(it) {
		const s = stateOf(it);
		return '<span class="state state--' + s + '">' + STATE_LABEL[s] + "</span>";
	}

	function fileStateText(it) {
		const s = fileSummary(it);
		if (s === "none") return '<span class="state state--none">No PDF</span>';
		if (s === "published") return '<span class="state state--published">PDF published</span>';
		if (s === "error") return '<span class="state state--error">PDF failed</span>';
		return '<span class="state state--staged">PDF staged</span>';
	}

	function bytesLabel(n) {
		if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
		if (n >= 1024) return Math.round(n / 1024) + " KB";
		return n + " B";
	}

	/* ---- editor form ---- */

	function fieldError(it, field) {
		return (it.draftErrors || []).some((e) => e.field === field);
	}

	function editorForm(it) {
		if (!it) return "";
		const ro = readOnly(it);
		const p = effective(it);
		const src = srcOf(it);
		const dis = ro ? " disabled" : "";
		const roNote = ro
			? '<div class="ro-note">' + icon("lock") +
				"<span>Imported from " + esc(src.label) + ", read only</span></div>"
			: "";

		const typePicker = ro
			? '<span class="kv">' + typeLabel(p.itemType) + "</span>"
			: '<select class="ctl ctl--type" data-bind="' + it.key + '|itemType" aria-label="Item type">' +
				SEED.ITEM_TYPES.map((t) =>
					'<option value="' + t + '"' + (p.itemType === t ? " selected" : "") + ">" +
					typeLabel(t) + "</option>").join("") +
			"</select>";

		const errors = (it.draftErrors || []).length
			? '<div class="verrors" role="alert">' +
				it.draftErrors.map((e) => "<div>" + icon("alert") + "<span>" + esc(e.message) + "</span></div>").join("") +
			"</div>"
			: "";

		const roles = SEED.rolesForType(p.itemType);
		const creators = (p.creators || []).map((c, iIdx) => {
			const single = c.name !== undefined;
			return '<div class="crow' + (fieldError(it, "creator:" + iIdx) ? " crow--invalid" : "") + '">' +
				'<select class="ctl crow-role" data-bind="' + it.key + "|creator:" + iIdx + ':creatorType" aria-label="Creator role"' + dis + ">" +
					roles.map((r) => '<option value="' + r + '"' + (c.creatorType === r ? " selected" : "") + ">" + r + "</option>").join("") +
					(roles.includes(c.creatorType) ? "" : '<option value="' + esc(c.creatorType) + '" selected>' + esc(c.creatorType) + "</option>") +
				"</select>" +
				(single
					? '<input class="ctl crow-name" data-bind="' + it.key + "|creator:" + iIdx + ':name" value="' + esc(c.name) + '" placeholder="Organisation name" aria-label="Name"' + dis + ">"
					: '<input class="ctl crow-last" data-bind="' + it.key + "|creator:" + iIdx + ':lastName" value="' + esc(c.lastName || "") + '" placeholder="Last name" aria-label="Last name"' + dis + ">" +
						'<input class="ctl crow-first" data-bind="' + it.key + "|creator:" + iIdx + ':firstName" value="' + esc(c.firstName || "") + '" placeholder="First name" aria-label="First name"' + dis + ">") +
				(ro ? "" :
					'<span class="crow-acts">' +
					iconBtn("creator-mode", single ? "userPlus" : "doc",
						single ? "Switch to first/last name" : "Switch to single name",
						{ key: it.key, arg: iIdx }) +
					iconBtn("creator-up", "up", "Move up", { key: it.key, arg: iIdx, disabled: iIdx === 0 }) +
					iconBtn("creator-down", "down", "Move down", { key: it.key, arg: iIdx, disabled: iIdx === (p.creators.length - 1) }) +
					iconBtn("creator-remove", "minus", "Remove creator", { key: it.key, arg: iIdx, danger: true }) +
					"</span>") +
			"</div>";
		}).join("");

		const fields = SEED.fieldsForType(p.itemType).map((f) =>
			'<div class="frow"><label for="f-' + it.key + "-" + f + '">' +
				esc(SEED.FIELD_LABELS[f] || f) + "</label>" +
				'<input class="fval" id="f-' + it.key + "-" + f + '" data-bind="' + it.key + "|field:" + f +
				'" value="' + esc((p.fields || {})[f] || "") + '"' + dis + ">" +
			"</div>").join("");

		const tags = (p.tags || []).map((t) =>
			'<span class="tagchip">' + esc(t) +
			(ro ? "" : iconBtn("tag-remove", "x", "Remove tag " + t, { key: it.key, arg: t })) +
			"</span>").join("");

		return '<div class="edform">' +
			roNote + errors +
			'<div class="ed-kicker">' + typePicker +
				'<span class="mono kv">' + it.key + "</span>" +
				'<span class="kv">' + esc(src.label) + "</span>" +
			"</div>" +
			'<label class="ed-lbl" for="title-' + it.key + '">Title</label>' +
			'<textarea class="fval ed-title' + (fieldError(it, "title") ? " fval--invalid" : "") +
				'" id="title-' + it.key + '" rows="2" data-bind="' + it.key + '|title"' + dis + ">" +
				esc(p.title || "") + "</textarea>" +
			'<div class="ed-sec"><span class="ed-lbl">Creators</span>' +
				'<div class="crows">' + (creators || '<div class="none-note">No creators</div>') + "</div>" +
				(ro ? "" : '<div class="ed-secacts">' + btnHTML("creator-add", "Add creator", { key: it.key, icon: "userPlus", ghost: true }) + "</div>") +
			"</div>" +
			'<div class="ed-sec"><span class="ed-lbl">' + typeLabel(p.itemType) + ' fields</span>' +
				'<div class="frows">' + fields + "</div>" +
			"</div>" +
			'<div class="ed-sec"><label class="ed-lbl" for="abs-' + it.key + '">Abstract</label>' +
				'<textarea class="fval ed-abs" id="abs-' + it.key + '" rows="4" data-bind="' + it.key + '|abstractNote"' + dis + ">" +
				esc(p.abstractNote || "") + "</textarea>" +
			"</div>" +
			'<div class="ed-sec"><span class="ed-lbl">Tags</span>' +
				'<div class="tagrow">' + (tags || '<span class="none-note">No tags</span>') + "</div>" +
				(ro ? "" :
					'<div class="tagadd"><input class="ctl" data-tag-input="' + it.key +
						'" placeholder="Add a tag" aria-label="Add a tag">' +
						iconBtn("tag-add", "plus", "Add tag", { key: it.key }) + "</div>") +
			"</div>" +
			'<div class="ed-sec"><span class="ed-lbl">Collections</span>' +
				membershipChecklist(it) +
			"</div>" +
		"</div>";
	}

	/* checklist context: "m:<itemKey>" for membership, "mgr" for manager */
	function membershipChecklist(it) {
		const ctx = "m:" + it.key;
		return '<div class="collpick">' +
			'<div class="collpick-search"><span class="collpick-icon">' + icon("search") + "</span>" +
				'<input class="ctl" data-coll-filter="' + ctx + '" placeholder="Filter collections" aria-label="Filter collections" value="' +
				esc(ui.collQuery[ctx] || "") + '">' +
			"</div>" +
			'<div class="collpick-list" data-coll-list="' + ctx + '">' +
				membershipRows(it) +
			"</div></div>";
	}

	function membershipRows(it) {
		const ctx = "m:" + it.key;
		const q = (ui.collQuery[ctx] || "").toLowerCase();
		const member = membershipOf(it);
		const ro = readOnly(it);
		const rows = [];
		const walk = (parentKey, depth) => {
			collChildren(parentKey).forEach((c) => {
				const path = collPath(c.key);
				if (!q || path.toLowerCase().includes(q)) {
					const locked = ro && c.sourceKey !== "native";
					rows.push('<label class="collrow" style="padding-left:' + (depth * 16 + 4) + 'px"' +
						(locked ? ' title="Managed by source sync"' : "") + ">" +
						'<input type="checkbox" data-act-check="coll-toggle" data-key="' + it.key +
							'" data-arg="' + c.key + '"' + (member.includes(c.key) ? " checked" : "") +
							(locked ? " disabled" : "") + ">" +
						'<span class="collrow-name">' + esc(c.name) + "</span>" +
						(c.sourceKey === "native" ? "" :
							'<span class="collrow-src">' + esc(srcLabel(c.sourceKey)) + "</span>") +
						(c.visibility === "private" ? '<span class="collrow-src">private</span>' : "") +
					"</label>");
				}
				walk(c.key, depth + 1);
			});
		};
		walk(null, 0);
		return rows.join("") || '<div class="none-note">No collections match</div>';
	}

	/* ---- lifecycle / publication panel ---- */

	function lifecyclePanel(it) {
		if (!it) return "";
		const ro = readOnly(it);
		const st = stateOf(it);
		const conflict = it.draft && it.draft.baseRevision !== it.revision;
		let rows =
			'<div class="lc-states">' + stateTag(it) +
				(it.itemType === "Attachment" ? "" : fileStateText(it)) +
				'<span class="kv mono">rev ' + it.revision + "</span>" +
				(it.draft ? '<span class="kv mono">draft ' + it.draft.draftRevision + "</span>" : "") +
			"</div>";

		if (ro) {
			return '<div class="lifecycle">' + rows +
				'<div class="ro-note">' + icon("lock") + "<span>Imported from " +
				esc(srcOf(it).label) + ", read only</span></div>" +
				'<div class="lc-acts">' +
					btnHTML("duplicate", "Duplicate as native draft", { key: it.key, icon: "copy" }) +
				"</div></div>";
		}

		if (conflict) {
			rows += '<div class="conflict" role="alert">' + icon("alert") +
				"<span>Draft is based on revision " + it.draft.baseRevision +
				", the record is now at " + it.revision + ".</span>" +
				'<span class="conflict-acts">' +
					btnHTML("rebase", "Rebase draft", { key: it.key, icon: "retry" }) +
				"</span></div>";
		}

		const acts = [];
		if (it.draft) {
			acts.push(btnHTML("save", "Save draft", { key: it.key, icon: "save" }));
			acts.push(btnHTML("publish", "Publish", {
				key: it.key, icon: "publish", primary: !conflict,
				disabled: conflict, title: conflict ? "Rebase the draft first" : "",
			}));
			acts.push(btnHTML("discard", it.published ? "Discard draft" : "Delete draft", {
				key: it.key, icon: it.published ? "discard" : "trash", ghost: true, danger: !it.published,
			}));
		}
		if (st === "published") {
			acts.push(btnHTML("unpublish", "Unpublish", {
				key: it.key, icon: "unpublish", ghost: true,
				title: it.itemType === "Attachment" && it.filePublication
					? "Unpublish the PDF first" : "",
			}));
		}
		if (st === "deleted") {
			acts.push(btnHTML("restore", "Restore", { key: it.key, icon: "restore", primary: true }));
		}
		if (!it.parentItem) {
			acts.push(btnHTML("duplicate", "Duplicate", { key: it.key, icon: "copy", ghost: true }));
		}

		return '<div class="lifecycle">' + rows +
			'<div class="autosave" data-autosave="' + it.key + '">' +
				(it.draft && it.draft.savedAt ? "Saved " + esc(it.draft.savedAt) : "") + "</div>" +
			'<div class="lc-acts">' + acts.join("") + "</div>" +
		"</div>";
	}

	/* ---- attachments panel ---- */

	function attachmentCard(att) {
		const ro = readOnly(att);
		const p = effective(att);
		const fd = att.fileDraft;
		const pub = att.filePublication;
		let fileZone = "";

		if (pub) {
			fileZone =
				'<div class="filemeta">' +
					'<div class="fm-cover" style="background:linear-gradient(160deg,' + (pub.coverFrom || "#2f2450") + "," + (pub.coverTo || "#141021") + ')">' + icon("doc") + "</div>" +
					'<div class="fm-facts">' +
						'<div class="fm-name mono">' + esc(pub.filename) + "</div>" +
						'<div class="fm-line">' + bytesLabel(pub.sizeBytes) + " · " + pub.pageCount + " pages</div>" +
						'<div class="fm-line">' + icon("check") + "<span>checksum verified · text extracted</span></div>" +
						'<div class="fm-line">published ' + esc(pub.publishedAt) + " · upload " + pub.uploadRevision + "</div>" +
					"</div>" +
					'<div class="fm-acts">' +
						iconBtn("file-preview", "eye", "Preview PDF", { key: att.key }) +
						iconBtn("file-download", "download", "Download PDF", { key: att.key }) +
						(ro ? "" :
							iconBtn("file-choose", "replace", "Replace PDF", { key: att.key }) +
							iconBtn("file-unpublish", "unpublish", "Unpublish PDF", { key: att.key })) +
					"</div>" +
				"</div>";
		} else if (fd && fd.status === "uploading") {
			fileZone =
				'<div class="filemeta">' +
					'<div class="fm-facts">' +
						'<div class="fm-name mono">' + esc(fd.filename) + "</div>" +
						'<div class="progress"><div class="progress-bar" data-upload-progress="' + att.key + '" style="width:' + fd.progress + '%"></div></div>' +
						'<div class="fm-line">uploading <span data-upload-pct="' + att.key + '">' + fd.progress + "%</span> · " + bytesLabel(fd.sizeBytes) + "</div>" +
					"</div>" +
					'<div class="fm-acts">' + iconBtn("file-remove", "x", "Cancel upload", { key: att.key }) + "</div>" +
				"</div>";
		} else if (fd && fd.status === "processing") {
			fileZone =
				'<div class="filemeta">' +
					'<div class="fm-facts">' +
						'<div class="fm-name mono">' + esc(fd.filename) + "</div>" +
						'<div class="fm-line"><span class="spin">' + icon("spinner") + "</span><span>verifying checksum, extracting text and cover</span></div>" +
					"</div>" +
				"</div>";
		} else if (fd && fd.status === "error") {
			fileZone =
				'<div class="filemeta filemeta--error">' +
					'<div class="fm-facts">' +
						'<div class="fm-name mono">' + esc(fd.filename) + "</div>" +
						'<div class="fm-line fm-line--error">' + icon("alert") + "<span>" + esc(fd.error || "Processing failed") + "</span></div>" +
						'<div class="fm-line">upload ' + fd.uploadRevision + "</div>" +
					"</div>" +
					'<div class="fm-acts">' +
						iconBtn("file-retry", "retry", "Retry verification", { key: att.key }) +
						iconBtn("file-choose", "replace", "Replace file", { key: att.key }) +
						iconBtn("file-remove", "trash", "Remove staged file", { key: att.key, danger: true }) +
					"</div>" +
				"</div>";
		} else if (fd && fd.status === "ready") {
			const guard = fileGuard(att);
			fileZone =
				'<div class="filemeta">' +
					'<div class="fm-cover" style="background:linear-gradient(160deg,' + (fd.coverFrom || "#2f2450") + "," + (fd.coverTo || "#141021") + ')">' + icon("doc") + "</div>" +
					'<div class="fm-facts">' +
						'<div class="fm-name mono">' + esc(fd.filename) + "</div>" +
						'<div class="fm-line">' + bytesLabel(fd.sizeBytes) + " · " + fd.pageCount + " pages · upload " + fd.uploadRevision + "</div>" +
						'<div class="fm-line">' + icon("check") + "<span>checksum verified · text extracted · staged privately</span></div>" +
					"</div>" +
					'<div class="fm-acts">' +
						iconBtn("file-preview", "eye", "Preview staged PDF", { key: att.key }) +
						(ro ? "" :
							iconBtn("file-publish", "publish", guard ? "Publish PDF: " + guard : "Publish PDF", { key: att.key, disabled: Boolean(guard), title: guard || "Publish PDF" }) +
							iconBtn("file-choose", "replace", "Replace file", { key: att.key }) +
							iconBtn("file-remove", "trash", "Remove staged file", { key: att.key, danger: true })) +
					"</div>" +
				"</div>";
		} else {
			fileZone = ro
				? '<div class="none-note">No file</div>'
				: '<div class="filedrop">' +
					btnHTML("file-choose", "Choose PDF", { key: att.key, icon: "upload" }) +
					btnHTML("file-sample", "Stage sample PDF", { key: att.key, icon: "doc", ghost: true }) +
				"</div>";
		}

		const metaActs = ro ? "" :
			'<span class="att-acts">' +
			(att.draft
				? iconBtn("publish", "publish", "Publish attachment metadata", { key: att.key })
				: "") +
			(stateOf(att) === "published"
				? iconBtn("unpublish", "unpublish",
					att.filePublication ? "Unpublish the PDF first" : "Unpublish attachment metadata",
					{ key: att.key, disabled: Boolean(att.filePublication) })
				: "") +
			(stateOf(att) === "deleted"
				? iconBtn("restore", "restore", "Restore attachment", { key: att.key })
				: "") +
			iconBtn("att-delete", "trash", att.filePublication ? "Unpublish the PDF first" : "Delete attachment",
				{ key: att.key, danger: true, disabled: Boolean(att.filePublication) }) +
			"</span>";

		return '<div class="attcard' + (att.deleted ? " attcard--deleted" : "") + '">' +
			'<div class="att-head">' + icon("paperclip") +
				(ro
					? '<span class="att-title">' + esc(p.title || "Attachment") + "</span>"
					: '<input class="fval att-title" data-bind="' + att.key + '|title" value="' +
						esc(p.title || "") + '" aria-label="Attachment title">') +
				stateTag(att) + metaActs +
			"</div>" +
			fileZone +
		"</div>";
	}

	function attachmentsPanel(it) {
		if (!it || it.itemType === "Attachment") return "";
		const kids = childrenOf(it.key);
		const ro = readOnly(it);
		return '<div class="attachments">' +
			(kids.length
				? kids.map(attachmentCard).join("")
				: '<div class="none-note">No attachments</div>') +
			(ro ? "" :
				'<div class="att-add">' +
					btnHTML("att-add", "Add attachment", { key: it.key, icon: "plus", ghost: true }) +
				"</div>") +
		"</div>";
	}

	/* ---- history ---- */

	function historyPanel(it) {
		if (!it) return "";
		const events = (it.history || []).map((e) => ({ at: e.at, event: e.event, detail: e.detail }));
		childrenOf(it.key).forEach((child) => {
			(child.history || []).forEach((e) => {
				events.push({ at: e.at, event: e.event, detail: e.detail, from: titleOf(child) });
			});
		});
		events.sort((a, b) => (a.at < b.at ? 1 : -1));
		return '<div class="histlist">' +
			(events.map((e) =>
				'<div class="histrow"><span class="hist-at mono">' + esc(e.at) + "</span>" +
				'<span class="hist-ev">' + esc(e.event) +
					(e.detail ? '<span class="hist-detail"> · ' + esc(e.detail) + "</span>" : "") +
					(e.from ? '<span class="hist-detail"> · ' + esc(e.from) + "</span>" : "") +
				"</span></div>").join("") ||
				'<div class="none-note">No history</div>') +
		"</div>";
	}

	/* ---- collection manager ---- */

	function collectionManager() {
		const rows = [];
		const walk = (parentKey, depth) => {
			collChildren(parentKey, true).forEach((c) => {
				if (c.deleted && parentKey !== null) return; /* deleted children listed flat below */
				if (c.deleted) return;
				rows.push(collManagerRow(c, depth));
				walk(c.key, depth + 1);
			});
		};
		walk(null, 0);
		const deletedRows = data.collections.filter((c) => c.deleted).map((c) =>
			'<div class="mgr-row mgr-row--deleted" style="padding-left:4px">' +
				icon("folder") +
				'<span class="mgr-name">' + esc(c.name) + "</span>" +
				'<span class="mgr-src">deleted</span>' +
				'<span class="mgr-acts">' +
					iconBtn("coll-restore", "restore", "Restore collection", { key: c.key }) +
				"</span></div>");

		return '<div class="collmgr">' +
			'<div class="mgr-toolbar">' +
				btnHTML("coll-create", "New collection", { icon: "folderPlus" }) +
			"</div>" +
			rows.join("") +
			(deletedRows.length ? '<div class="mgr-deleted-h">Deleted</div>' + deletedRows.join("") : "") +
		"</div>";
	}

	function collManagerRow(c, depth) {
		const native = c.sourceKey === "native";
		return '<div class="mgr-row" style="padding-left:' + (depth * 18 + 4) + 'px">' +
			icon("folder") +
			'<span class="mgr-name">' + esc(c.name) + "</span>" +
			(c.visibility === "private" ? '<span class="mgr-src">private</span>' : "") +
			(native ? "" : '<span class="mgr-src">' + esc(srcLabel(c.sourceKey)) + "</span>") +
			(c.description ? '<span class="mgr-desc" title="' + esc(c.description) + '">' + esc(c.description) + "</span>" : "") +
			'<span class="mgr-acts">' +
				(native
					? iconBtn("coll-child", "folderPlus", "New child collection", { key: c.key }) +
						iconBtn("coll-edit", "pencil", "Rename or edit", { key: c.key }) +
						iconBtn("coll-move", "move", "Move to another parent", { key: c.key }) +
						iconBtn("coll-delete", "trash", "Delete collection", { key: c.key, danger: true })
					: '<span class="mgr-lock" title="Managed by source sync">' + icon("lock") + "</span>") +
			"</span></div>";
	}

	/* ---- bulk bar ---- */

	function bulkBar() {
		const n = bulkKeys().length;
		if (!n) return "";
		return '<div class="bulkbar">' +
			"<span>" + n + " selected</span>" +
			btnHTML("bulk-add-coll", "Add to collection", { icon: "folderPlus" }) +
			btnHTML("bulk-remove-coll", "Remove from collection", { icon: "folder", ghost: true }) +
			btnHTML("bulk-publish", "Publish drafts", { icon: "publish", ghost: true }) +
			btnHTML("bulk-delete", "Unpublish", { icon: "unpublish", ghost: true }) +
			iconBtn("bulk-clear", "x", "Clear selection") +
		"</div>";
	}

	/* ---- new item modal ---- */

	function newItemModal() {
		openModal("New item",
			'<input class="ctl pm-typefilter" data-typefilter placeholder="Filter item types" aria-label="Filter item types" autofocus>' +
			'<div class="typelist" data-typelist>' + typeListRows("") + "</div>",
			{});
	}
	function typeListRows(q) {
		const query = q.toLowerCase();
		return SEED.ITEM_TYPES
			.filter((t) => !query || typeLabel(t).toLowerCase().includes(query))
			.map((t) => '<button class="typerow" data-act="new-item-type" data-arg="' + t + '">' +
				icon("doc") + "<span>" + typeLabel(t) + "</span></button>").join("") ||
			'<div class="none-note">No matching types</div>';
	}

	/* ---- preview modal ---- */

	function previewFile(att) {
		const f = att.filePublication || att.fileDraft;
		if (!f) return;
		openModal("Preview",
			'<div class="preview">' +
				'<div class="preview-cover" style="background:linear-gradient(160deg,' +
					(f.coverFrom || "#2f2450") + "," + (f.coverTo || "#141021") + ')">' +
					icon("doc") +
					'<span class="preview-pages">' + (f.pageCount || "?") + " pages</span>" +
				"</div>" +
				'<div class="preview-meta">' +
					'<div class="mono">' + esc(f.filename) + "</div>" +
					"<div>" + bytesLabel(f.sizeBytes) + "</div>" +
					(f.sha256 ? '<div class="mono preview-sha">sha256 ' + esc(f.sha256.slice(0, 16)) + "…</div>" : "") +
					(att.filePublication
						? '<div class="preview-url mono">' + esc(att.filePublication.publicUrl) + "</div>"
						: "<div>staged privately, not yet public</div>") +
				"</div>" +
			"</div>", {});
	}

	/* ================= event delegation ================= */

	let pendingFileKey = null;

	function ensureChrome() {
		if (document.getElementById("proto-file-input")) return;
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/pdf";
		input.id = "proto-file-input";
		input.hidden = true;
		input.addEventListener("change", () => {
			const file = input.files && input.files[0];
			const att = pendingFileKey ? byKey(pendingFileKey) : null;
			if (file && att) stageFile(att, file.name, file.size);
			pendingFileKey = null;
			input.value = "";
		});
		document.body.appendChild(input);
	}

	const ACTS = {
		"new-item": function () { newItemModal(); },
		"new-item-type": function (el) { closeModal(); createItem(el.dataset.arg); toast(typeLabel(el.dataset.arg) + " draft created"); },
		"reset-demo": function () { resetDemo(); },
		"modal-close": function () { closeModal(); },
		"modal-confirm": function () {
			if (modalSubmit && modalSubmit() === false) return;
			closeModal();
		},

		save: function (el, it) { commitDraft(it); },
		publish: function (el, it) { publishItem(it); },
		unpublish: function (el, it) {
			confirmAction('Unpublish "' + titleOf(it) + '"? It stays recoverable as a deleted record.',
				"Unpublish", function () { unpublishItem(it); return true; }, true);
		},
		restore: function (el, it) { restoreItem(it); },
		discard: function (el, it) {
			confirmAction(it.published
				? "Discard the draft changes? The published record is kept."
				: 'Delete the draft "' + titleOf(it) + '"? It was never published.',
				it.published ? "Discard" : "Delete", function () { discardDraft(it); return true; }, true);
		},
		rebase: function (el, it) { rebaseDraft(it); },
		duplicate: function (el, it) { duplicateItem(it); },

		"creator-add": function (el, it) { addCreator(it); },
		"creator-remove": function (el, it) { removeCreator(it, Number(el.dataset.arg)); },
		"creator-up": function (el, it) { moveCreator(it, Number(el.dataset.arg), -1); },
		"creator-down": function (el, it) { moveCreator(it, Number(el.dataset.arg), 1); },
		"creator-mode": function (el, it) { toggleCreatorMode(it, Number(el.dataset.arg)); },

		"tag-add": function (el, it) {
			const input = document.querySelector('[data-tag-input="' + it.key + '"]');
			if (input) { addTag(it, input.value); input.value = ""; }
		},
		"tag-remove": function (el, it) { removeTag(it, el.dataset.arg); },

		"att-add": function (el, it) { createAttachmentFor(it); },
		"att-delete": function (el, it) {
			confirmAction('Delete the attachment "' + titleOf(it) + '"?', "Delete",
				function () {
					if (it.filePublication) { toast("Unpublish the PDF first"); return true; }
					if (it.published) { unpublishItem(it); }
					else {
						clearFileTimer(it.key);
						data.items = data.items.filter((cand) => cand.key !== it.key);
						save(); emit(); toast("Attachment deleted");
					}
					return true;
				}, true);
		},

		"file-choose": function (el, it) {
			ensureChrome();
			pendingFileKey = it.key;
			document.getElementById("proto-file-input").click();
		},
		"file-sample": function (el, it) {
			stageFile(it, "sample-report-" + it.key.slice(0, 4).toLowerCase() + ".pdf",
				917504 + (it.key.charCodeAt(0) * 4096));
		},
		"file-remove": function (el, it) { removeStagedFile(it); },
		"file-retry": function (el, it) { retryFile(it); },
		"file-publish": function (el, it) { publishFile(it); },
		"file-unpublish": function (el, it) {
			confirmAction("Unpublish this PDF? The public link stops working; attachment metadata is kept.",
				"Unpublish PDF", function () { unpublishFile(it); return true; }, true);
		},
		"file-preview": function (el, it) { previewFile(it); },
		"file-download": function (el, it) {
			const pub = it.filePublication;
			toast(pub ? "Download link copied (mock): " + pub.filename : "No published file");
		},

		"coll-create": function () { createCollection(null); },
		"coll-child": function (el) { createCollection(el.dataset.key); },
		"coll-edit": function (el) { const c = collByKey(el.dataset.key); if (c) editCollection(c); },
		"coll-move": function (el) { const c = collByKey(el.dataset.key); if (c) moveCollection(c); },
		"coll-delete": function (el) { const c = collByKey(el.dataset.key); if (c) deleteCollection(c); },
		"coll-restore": function (el) { const c = collByKey(el.dataset.key); if (c) restoreCollection(c); },

		"bulk-add-coll": function () { bulkCollectionModal("add"); },
		"bulk-remove-coll": function () { bulkCollectionModal("remove"); },
		"bulk-publish": function () { bulkPublish(); },
		"bulk-delete": function () { bulkDelete(); },
		"bulk-clear": function () { bulkClear(); },
	};

	function createAttachmentFor(parent) {
		const att = createItem("Attachment", parent.key);
		pushHistory(parent, "Attachment added", titleOf(att));
		save(); emit();
	}

	document.addEventListener("click", (event) => {
		const actEl = event.target.closest("[data-act]");
		if (actEl && !actEl.disabled) {
			const handler = ACTS[actEl.dataset.act];
			if (handler) {
				const it = actEl.dataset.key ? byKey(actEl.dataset.key) : selected();
				handler(actEl, it);
				return;
			}
		}
		const sel = event.target.closest("[data-select]");
		if (sel) {
			if (event.target.closest("[data-bulk], [data-act], input, button, a, select")) return;
			ui.selected = sel.getAttribute("data-select");
			emit();
			return;
		}
		const sort = event.target.closest("[data-sort]");
		if (sort) {
			const key = sort.getAttribute("data-sort");
			ui.sort = { key: key, dir: ui.sort.key === key ? -ui.sort.dir : 1 };
			emit();
		}
	});

	document.addEventListener("change", (event) => {
		const check = event.target.closest("[data-act-check='coll-toggle']");
		if (check) {
			const it = byKey(check.dataset.key);
			if (it) toggleMembership(it, check.dataset.arg);
			return;
		}
		const bulk = event.target.closest("[data-bulk]");
		if (bulk) { bulkToggle(bulk.dataset.bulk); return; }
		const bind = event.target.closest("[data-bind]");
		if (bind && (bind.tagName === "SELECT")) {
			const parts = bind.dataset.bind.split("|");
			const it = byKey(parts[0]);
			if (!it) return;
			if (parts[1] === "itemType") { changeItemType(it, bind.value); return; }
			setDraftValue(it, parts[1], bind.value);
			commitDraft(it, true);
			emit();
		}
	});

	document.addEventListener("input", (event) => {
		const bind = event.target.closest("[data-bind]");
		if (bind && bind.tagName !== "SELECT") {
			const parts = bind.dataset.bind.split("|");
			const it = byKey(parts[0]);
			if (it) setDraftValue(it, parts[1], bind.value);
			return;
		}
		const collFilter = event.target.closest("[data-coll-filter]");
		if (collFilter) {
			const ctx = collFilter.dataset.collFilter;
			ui.collQuery[ctx] = collFilter.value;
			const list = document.querySelector('[data-coll-list="' + ctx + '"]');
			if (list && ctx.startsWith("m:")) {
				const it = byKey(ctx.slice(2));
				if (it) list.innerHTML = membershipRows(it);
			}
			return;
		}
		const typeFilter = event.target.closest("[data-typefilter]");
		if (typeFilter) {
			const list = document.querySelector("[data-typelist]");
			if (list) list.innerHTML = typeListRows(typeFilter.value);
		}
	});

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && document.querySelector(".proto-modal-wrap")) {
			closeModal();
			/* pages listening for Escape (sheets, drawers) skip this event */
			window.__protoEscConsumedAt = Date.now();
		}
		if (event.key !== "Enter" && event.key !== " ") return;
		const tag = event.target.closest && event.target.closest("[data-tag-input]");
		if (tag && event.key === "Enter") {
			event.preventDefault();
			const it = byKey(tag.dataset.tagInput);
			if (it) { addTag(it, tag.value); tag.value = ""; }
			return;
		}
		if (event.target.matches && event.target.matches("[data-select], [data-sort]") &&
			!event.target.closest("input, textarea, select, button")) {
			event.preventDefault();
			event.target.click();
		}
	});

	/* ---- logo ---- */
	function logoHTML(extraClass) {
		return '<span class="brandmark' + (extraClass ? " " + extraClass : "") + '">' +
			'<img data-library-logo src="' + esc(SEED.identity.assets.logoDark) +
			'" alt="' + esc(SEED.identity.name) +
			'" onerror="this.hidden=true;this.nextElementSibling.hidden=false">' +
			'<span class="brandname" hidden>' + esc(SEED.identity.name) + "</span></span>";
	}

	/* ---- page utilities: filter controls ---- */

	function fillSelect(el, first, entries, current) {
		if (!el) return;
		el.innerHTML = '<option value="all">' + esc(first) + "</option>" +
			entries.map((e) =>
				'<option value="' + esc(e[0]) + '"' + (current === e[0] ? " selected" : "") + ">" +
				esc(e[1]) + "</option>").join("");
	}

	function filterEntries() {
		const types = {};
		topItems().forEach((it) => { types[effective(it).itemType] = true; });
		const collEntries = [];
		const walk = (parentKey, depth) => {
			collChildren(parentKey).forEach((c) => {
				collEntries.push([c.key, " ".repeat(depth * 3) + c.name]);
				walk(c.key, depth + 1);
			});
		};
		walk(null, 0);
		return {
			source: SEED.sources.map((s) => [s.key, s.label]),
			type: Object.keys(types).sort().map((t) => [t, typeLabel(t)]),
			state: [["draft", "Draft"], ["edited", "Edited"], ["published", "Published"], ["deleted", "Deleted"]],
			file: [["published", "PDF published"], ["staged", "PDF staged"], ["error", "PDF failed"], ["none", "No PDF"]],
			collection: collEntries,
		};
	}

	/*
	 * Wire a page's static search input + filter selects. `map` values are
	 * elements (or null): { q, source, type, state, file, collection, reset }.
	 * Selects are refilled on every emit while preserving element identity.
	 */
	function wireFilters(map) {
		const FIRST = {
			source: "All sources", type: "All types", state: "All states",
			file: "Any PDF state", collection: "All collections",
		};
		if (map.q) {
			map.q.addEventListener("input", () => { ui.query = map.q.value; emit(); });
		}
		["source", "type", "state", "file", "collection"].forEach((k) => {
			if (!map[k]) return;
			map[k].addEventListener("change", () => { ui[k] = map[k].value; emit(); });
		});
		if (map.reset) {
			map.reset.addEventListener("click", () => {
				ui.query = ""; ui.source = "all"; ui.type = "all";
				ui.state = "all"; ui.file = "all"; ui.collection = "all";
				if (map.q) map.q.value = "";
				emit();
			});
		}
		function refill() {
			const entries = filterEntries();
			["source", "type", "state", "file", "collection"].forEach((k) => {
				if (map[k]) fillSelect(map[k], FIRST[k], entries[k], ui[k]);
			});
		}
		subscribe(refill);
		refill();
	}

	ensureChrome();

	/* default selection */
	ui.selected = (topItems().filter((it) => !it.deleted)[0] || {}).key || null;

	return {
		/* data + ui */
		data: data, ui: ui, sources: SEED.sources, SEED: SEED,
		/* store */
		subscribe: subscribe, emit: emit, save: save,
		/* selectors */
		byKey: byKey, collByKey: collByKey, topItems: topItems, childrenOf: childrenOf,
		filtered: filtered, selected: selected, effective: effective,
		stateOf: stateOf, STATE_LABEL: STATE_LABEL, fileSummary: fileSummary,
		FILE_FILTER_LABEL: FILE_FILTER_LABEL,
		srcOf: srcOf, readOnly: readOnly, srcLabel: srcLabel,
		activeCollections: activeCollections, collChildren: collChildren,
		collPath: collPath, membershipOf: membershipOf,
		titleOf: titleOf, typeLabel: typeLabel, creatorsLine: creatorsLine,
		creatorName: creatorName, year: year, venue: venue, bytesLabel: bytesLabel,
		esc: esc, icon: icon, toast: toast, bulkKeys: bulkKeys,
		fillSelect: fillSelect, wireFilters: wireFilters, filterEntries: filterEntries,
		/* renderers */
		C: {
			editorForm: editorForm,
			lifecycle: lifecyclePanel,
			attachments: attachmentsPanel,
			history: historyPanel,
			collectionManager: collectionManager,
			membership: membershipChecklist,
			bulkBar: bulkBar,
			stateTag: stateTag,
			fileStateText: fileStateText,
			iconBtn: iconBtn,
			btn: btnHTML,
		},
		logoHTML: logoHTML,
	};
})();
