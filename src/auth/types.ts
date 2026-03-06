export type SessionDateValue = string | Date;

export type AppCollection = {
	id: string;
	userId: string;
	name: string;
	description: string | null;
	private: boolean | null;
	numItems: number | null;
	deleted: boolean | null;
	createdAt: SessionDateValue;
	updatedAt: SessionDateValue;
};

export type AppSessionUser = {
	id: string;
	name?: string | null;
	email?: string | null;
	image?: string | null;
	createdAt?: SessionDateValue;
	likes: Record<string, SessionDateValue>;
	following: Record<string, SessionDateValue>;
	followers: Record<string, SessionDateValue>;
	collections: AppCollection[];
	itemsCollections: Record<string, Record<string, SessionDateValue>>;
};

export type AppSession = {
	user: AppSessionUser;
};

export type SessionStatus = "loading" | "authenticated" | "unauthenticated";
