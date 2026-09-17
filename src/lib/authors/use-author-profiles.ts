"use client";

import useSWR from "swr";
import { createContext, useContext, useMemo } from "react";
import type { Author } from "@/app/api/item/types";
import { creatorFromProfile, parseAuthorCatalog, type AuthorProfile } from "./profiles";

export const AuthorProfilesContext = createContext<Map<string, AuthorProfile> | undefined>(undefined);

export function useAuthorProfiles<T extends Author>(creators: readonly T[] | null | undefined) {
  const sharedProfiles = useContext(AuthorProfilesContext);
  const ids = [...new Set(creators?.flatMap(creator => creator.authorProfileId ? [creator.authorProfileId] : []) ?? [])].sort();
  const result = useSWR(!sharedProfiles && ids.length ? ["author-profiles", ...ids] : null, async ([, ...profileIds]) => {
    const batches = await Promise.all(Array.from({length: Math.ceil(profileIds.length / 100)}, async (_, index) => {
      const query = new URLSearchParams(profileIds.slice(index * 100, (index + 1) * 100).map(id => ["id", id]));
      const response = await fetch(`/api/author-profiles?${query}`, {cache: "no-store"});
      if (!response.ok) throw new Error("Author profiles are unavailable");
      return parseAuthorCatalog(await response.json());
    }));
    return {profiles: batches.flatMap(batch => batch.profiles)};
  }, {revalidateOnMount: true, errorRetryCount: 1});
  const fetchedProfiles = useMemo(() => new Map(result.data?.profiles.map(profile => [profile.id, profile])), [result.data]);
  const profiles = sharedProfiles ?? fetchedProfiles;
  return {...result, profiles, creators: creators?.map(creator => {
    const profile = creator.authorProfileId ? profiles.get(creator.authorProfileId) : undefined;
    // Affiliations saved on the record are from the time of writing. The profile's is the fallback.
    return profile ? {...creatorFromProfile(creator, profile), institutions: creator.institutions?.length ? creator.institutions : profile.affiliation ? [{display_name: profile.affiliation}] : []} : creator;
  })};
}
