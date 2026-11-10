import { buildZenodoRecordPayload, jsonValueSchema, type ZenodoWriter } from "@opendeved/doi-sync-core";

type PrepareRequest = Pick<Parameters<ZenodoWriter["prepareUpdateRecordMetadata"]>[0], "doiPolicy" | "metadata" | "resourceUrl" | "onPreparedDraft">;

async function preparedZenodoTestDraft(request: PrepareRequest, id: string, parentId: string) {
 const draft = {
  depositionId: id, draftRecordId: id, parentId,
  payloadSnapshot: jsonValueSchema.parse(buildZenodoRecordPayload({doiPolicy: request.doiPolicy, metadata: request.metadata, resourceUrl: request.resourceUrl})),
 };
 await request.onPreparedDraft?.(draft);
 return draft;
}

export function successfulZenodoTestProvider(
 ids: () => {id: string; parentId: string},
 publishedAt = new Date("2030-08-13T12:00:00.000Z"),
 discardPreparedDraft = async () => {},
): import("../../src/lib/publication/zenodo-adapter").ZenodoPublicationProvider {
 const prepared = (request: PrepareRequest) => {const {id, parentId} = ids();return preparedZenodoTestDraft(request, id, parentId);};
 return {
  prepareEmptyDraft: async request => {const draft = {depositionId: "90001", draftRecordId: "90001"};await request.onPreparedDraft?.(draft);return draft;},
  verifyPublishedState: async () => ({status: "matched"}),
  findRecordByDoi: async () => ({status: "not_found"}),
  deleteUnpublishedDraft: async () => undefined,
  discardPreparedDraft,
  prepareCreateRecord: prepared, prepareUpdateRecordMetadata: prepared, prepareUpdateRecordFiles: prepared, prepareNewVersion: prepared,
  publishDraft: async ({draft}) => ({latestRecordId: draft.draftRecordId, parentId: draft.parentId ?? draft.draftRecordId, publishedAt, versionDoi: `10.5072/zenodo.${draft.draftRecordId}`, conceptDoi: `10.5072/zenodo.${draft.parentId ?? draft.draftRecordId}`, links: {}}),
 };
}
