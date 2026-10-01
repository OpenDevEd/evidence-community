"use client";

import { createAuthClient } from "better-auth/react";

/** The browser side of OpenScholar sign-in. It never redirects on its own. */
export const readerAuthClient = createAuthClient({ basePath: "/api/auth" });
