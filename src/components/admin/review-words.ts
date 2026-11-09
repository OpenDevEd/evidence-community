"use client";

import { createContext, useContext } from "react";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import type { AdminItemDetail } from "@/lib/admin/types";

/** What sending a version back is called, in the button, its dialog and the state it leaves. */
type ReturnWords = { action: string; title: string; field: string; placeholder: string; confirm: string; state: string; done: string; senderOnlyWithdraw: boolean };

/** A version its sender can change and send again. */
const REQUEST: ReturnWords = {
	action: "Request changes",
	title: "Request changes",
	field: "What needs to change?",
	placeholder: "Describe the changes needed before publication",
	confirm: "Send feedback",
	state: "Changes requested",
	done: "Changes requested",
	senderOnlyWithdraw: false,
};

/**
 * A paper someone sent from Openscholar or this site, who can't change it, only send it again: the team declines it with
 * a reason, which the sender reads in Your submissions, and only the sender withdraws it.
 */
const DECLINE: ReturnWords = {
	action: "Decline",
	title: "Decline this paper",
	field: "Why isn't it right for this community?",
	placeholder: "The person who sent it reads this in Your submissions on Openscholar",
	confirm: "Decline",
	state: "Declined",
	done: "Paper declined",
	senderOnlyWithdraw: true,
};

export const returnWordsFor = (detail: Pick<AdminItemDetail, "sourceConnectionKey">) => (detail.sourceConnectionKey === ADDED_PAPERS_SOURCE_CONNECTION_KEY ? DECLINE : REQUEST);

export const ReturnWordsContext = createContext<ReturnWords>(REQUEST);

export const useReturnWords = () => useContext(ReturnWordsContext);
