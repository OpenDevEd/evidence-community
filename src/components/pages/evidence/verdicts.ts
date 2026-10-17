import { Alert02Icon, CancelCircleIcon, CheckmarkBadge01Icon, CheckmarkCircle02Icon, Clock01Icon, ViewOffIcon, Wrench01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/icons/Hugeicon";
import type { Kind, Verdict } from "./data";

/** Each verdict's name and icon, in the order a reader should worry about them. */
export const VERDICT: Record<Exclude<Verdict, "notAssessed">, { label: string; icon: IconSvgElement }> = {
	broken: { label: "Broken", icon: CancelCircleIcon },
	questionable: { label: "Questionable", icon: Alert02Icon },
	repairable: { label: "Repairable", icon: Wrench01Icon },
	caveats: { label: "Validated with caveats", icon: CheckmarkCircle02Icon },
	validated: { label: "Validated", icon: CheckmarkBadge01Icon },
	unverifiable: { label: "Unverifiable", icon: ViewOffIcon },
	pending: { label: "Pending", icon: Clock01Icon },
};

export const VERDICT_ORDER = ["broken", "questionable", "repairable", "caveats", "validated", "unverifiable", "pending"] as const;

export const KIND_LABEL: Record<Kind, string | null> = {
	unknown: null,
	primary: "Primary study",
	review: "Systematic review",
	meta: "Meta-analysis",
	secondOrder: "Review of reviews",
	commentary: "Commentary",
	methods: "Methods reference",
	critique: "Critique",
};

/** The types a reader can light, in the order of a chain's columns: studies, what analyses them, what reviews those. */
export const TYPE_ORDER = ["primary", "meta", "review", "secondOrder", "critique", "commentary"] as const satisfies readonly Kind[];

export const KIND_PLURAL: Record<(typeof TYPE_ORDER)[number], string> = {
	primary: "Primary studies",
	meta: "Meta-analyses",
	review: "Systematic reviews",
	secondOrder: "Reviews of reviews",
	critique: "Critiques",
	commentary: "Commentaries",
};

