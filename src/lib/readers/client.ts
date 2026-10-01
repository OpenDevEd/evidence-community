"use client";

import { createAuthClient } from "better-auth/react";

/**
 * The browser side of OpenScholar sign-in. It never redirects on its own.
 * An open tab reads the session every five minutes, as often as the session
 * cookie's copy expires, so a reader who stays on one page still gets their
 * OpenScholar account checked and sees a new name soon after.
 */
export const readerAuthClient = createAuthClient({
	basePath: "/api/auth",
	sessionOptions: { refetchInterval: 5 * 60 },
});
