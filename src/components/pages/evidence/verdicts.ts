import { Alert02Icon, CancelCircleIcon, CheckmarkBadge01Icon, CheckmarkCircle02Icon, Clock01Icon, ViewOffIcon, Wrench01Icon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@/components/icons/Hugeicon";
import type { Kind, Verdict } from "./data";

/** Each verdict's name and icon, in the order a reader should worry about them. */
export const VERDICT = {
	broken: { label: "verdicts.broken", icon: CancelCircleIcon },
	questionable: { label: "verdicts.questionable", icon: Alert02Icon },
	repairable: { label: "verdicts.repairable", icon: Wrench01Icon },
	caveats: { label: "verdicts.caveats", icon: CheckmarkCircle02Icon },
	validated: { label: "verdicts.validated", icon: CheckmarkBadge01Icon },
	unverifiable: { label: "verdicts.unverifiable", icon: ViewOffIcon },
	pending: { label: "verdicts.pending", icon: Clock01Icon },
} as const satisfies Record<Exclude<Verdict, "notAssessed">, { label: string; icon: IconSvgElement }>;

export const VERDICT_ORDER = ["broken", "questionable", "repairable", "caveats", "validated", "unverifiable", "pending"] as const;

export const KIND_LABEL = {
	unknown: null,
	primary: "kinds.primary",
	review: "kinds.review",
	meta: "kinds.meta",
	secondOrder: "kinds.secondOrder",
	commentary: "kinds.commentary",
	methods: "kinds.methods",
	critique: "kinds.critique",
	methodsPaper: "kinds.methodsPaper",
} as const satisfies Record<Kind, string | null>;

/** The types a reader can light, in the order of a chain's columns: studies, what analyses them, what reviews those. */
export const TYPE_ORDER = ["primary", "meta", "review", "secondOrder", "critique", "commentary", "methodsPaper"] as const satisfies readonly Kind[];

export const KIND_PLURAL = {
	primary: "kindsPlural.primary",
	meta: "kindsPlural.meta",
	review: "kindsPlural.review",
	secondOrder: "kindsPlural.secondOrder",
	critique: "kindsPlural.critique",
	commentary: "kindsPlural.commentary",
	methodsPaper: "kindsPlural.methodsPaper",
} as const satisfies Record<(typeof TYPE_ORDER)[number], string>;

