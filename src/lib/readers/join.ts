/**
 * Whether someone can apply to join this community's team: applying is `open`, their application is `waiting` for the
 * team's answer, or it is `closed` (the community is private, or its team turned applications off).
 */
export type JoinStanding = "open" | "waiting" | "closed";

export const joinStandingOf = (value: unknown): JoinStanding => (value === "waiting" || value === "closed" ? value : "open");

/**
 * MOCK: Openscholar will answer this on a service route, beside the reader's role (admin-session/check). The mock
 * reads a cookie that /api/mock sets.
 */
export const MOCK_JOIN_COOKIE = "mock_join";
