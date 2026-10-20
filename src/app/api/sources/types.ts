/** One of the library's sources as readers see it: the key its records are filtered by, and its name. */
export type PublicSource = { key: string; name: string };

export type SourcesGetResponse = { sources: PublicSource[] };
