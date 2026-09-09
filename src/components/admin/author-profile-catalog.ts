export type AuthorProfile = {
	id: string; url: string; revision?: number; name: string; affiliation: string; bio: string;
	orcid: string; openalex: string; website: string; canEdit: boolean;
};
export async function requestAuthorProfiles(body: Record<string, unknown>): Promise<{profiles: AuthorProfile[]; profileBaseUrl: string}> {
	const response = await fetch('/api/admin/author-profiles', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
	const result = await response.json();
	if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : result.error?.message ?? 'Unable to load author profiles');
	return {...result, profiles: result.profiles.map((profile: Omit<AuthorProfile, "url">) => ({...profile, url: new URL(`/authors/${profile.id}`, result.profileBaseUrl).href}))};
}
