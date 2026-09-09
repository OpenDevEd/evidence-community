"use client";
import { useLayoutEffect, useRef } from "react";
import type { AdminItemDetail, AdminItemLinkKind } from "@/lib/admin/types";
import { linkKeysFromPayload } from "./admin-diff";

export type ReviewLinkPicker = {
 itemKey: string;
 keys: ReadonlySet<string>;
 change: (keys: readonly string[], selected: boolean) => ReadonlySet<string>;
};

export function useReviewLinkPicker({detail, payload, change, enabled, onStart}: {
    detail: AdminItemDetail | undefined;
    payload: Record<string, unknown>;
    change: (key: string, payload: Record<string, unknown>) => void;
    enabled: boolean;
    onStart: (kind: AdminItemLinkKind, picker: ReviewLinkPicker) => void;
}) {
    const current = useRef({detail, payload, change});
    useLayoutEffect(() => { current.current = {detail, payload, change}; }, [detail, payload, change]);
    return (kind: AdminItemLinkKind) => {
        if (!detail || !enabled) return;
        const sourceKeys = detail.links.fromSources.filter(link => link.kind === kind).map(link => link.key);
        onStart(kind, {
            itemKey: detail.key,
            keys: new Set([...linkKeysFromPayload(payload, detail.links.publishedKeys)[kind], ...sourceKeys]),
            change: (keys, selected) => {
                const edit = current.current;
                if (!edit.detail) return new Set<string>();
                const itemKey = edit.detail.key;
                const links = linkKeysFromPayload(edit.payload, edit.detail.links.publishedKeys);
                const next = selected
                    ? [...new Set([...links[kind], ...keys.filter(key => key !== itemKey && !sourceKeys.includes(key))])]
                    : links[kind].filter(key => !keys.includes(key));
                const nextPayload = {...edit.payload, links: {...links, [kind]: next}};
                current.current = {...edit, payload: nextPayload};
                edit.change(itemKey, nextPayload);
                return new Set([...next, ...sourceKeys]);
            },
        });
    };
}
