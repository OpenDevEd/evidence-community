/**
 * Whether someone can apply to join this community's team: applying is `open`, their application is `waiting` for the
 * team's answer, or it is `closed` (the community is private, or its team turned applications off).
 */
export type JoinStanding = "open" | "waiting" | "closed";

/** The standing an answer names; anything else reads as `open`, where Join leads to Openscholar's own word on it. */
export const parseJoinStanding = (value: unknown): JoinStanding => (value === "waiting" || value === "closed" ? value : "open");
