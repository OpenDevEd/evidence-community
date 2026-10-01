"use client";

// MOCK ONLY: stands in for the Better Auth session until phase 2 of
// plans/openscholar-reader-accounts. Signing in here skips the trip to
// OpenScholar and returns a fixed reader. `?mockReader=nameless` signs in as
// a reader whose OpenScholar account has no name.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type MockReader = { id: string; name: string; image: string | null };

type MockReaderSession = {
	reader: MockReader | null;
	signIn: () => void;
	signOut: () => void;
};

const STORAGE_KEY = "mock-openscholar-reader";
export const OPENSCHOLAR_ACCOUNT_URL = "https://accounts.openscholar.ai/user";

const READERS: Record<"named" | "nameless", MockReader> = {
	named: { id: "user_mock_reader", name: "Amina Okafor", image: null },
	nameless: { id: "user_mock_nameless", name: "", image: null },
};

const Context = createContext<MockReaderSession>({
	reader: null,
	signIn: () => {},
	signOut: () => {},
});

export function MockReaderSessionProvider({ children }: { children: ReactNode }) {
	const [reader, setReader] = useState<MockReader | null>(null);

	// The mock keeps its session in localStorage, an outside browser system.
	useEffect(() => {
		const saved = window.localStorage.getItem(STORAGE_KEY);
		if (saved === "named" || saved === "nameless") setReader(READERS[saved]);
	}, []);

	const signIn = () => {
		const kind = new URLSearchParams(window.location.search).get("mockReader") === "nameless" ? "nameless" : "named";
		window.localStorage.setItem(STORAGE_KEY, kind);
		setReader(READERS[kind]);
	};
	const signOut = () => {
		window.localStorage.removeItem(STORAGE_KEY);
		setReader(null);
	};

	return <Context value={{ reader, signIn, signOut }}>{children}</Context>;
}

export function useMockReaderSession() {
	return useContext(Context);
}
