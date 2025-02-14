import { getDescendantKeys, recursiveFind } from "@/lib/collections";
import { buildHierarchy } from "@/lib/collections";
import { useParamsState } from "./useParamsState";
import { useMemo } from "react";
import { Collection, CollectionsGetResponse } from "@/app/api/collections/types";

export function useHierarchy({
  data,
  queryParams,
  ...paramsState
}: {
  data: CollectionsGetResponse | undefined;
  queryParams: { [key: string]: any };
} & ReturnType<typeof useParamsState>) {
  const selectedCollections = queryParams.collections;

  const hierarchy = useMemo(() => {
    if (!data) return [];
    return buildHierarchy(data.collections as Collection[]);
  }, [data]);

  const handleCheckboxChange = (key: string) => {
    let newSelectedCollections: string[];

    if (key === "") {
      newSelectedCollections = [];
    } else {
      const alreadySelected = selectedCollections.includes(key);

      if (alreadySelected) {
        const collectionToDeselect = recursiveFind(key, hierarchy);

        const descendantKeys = collectionToDeselect
          ? getDescendantKeys(collectionToDeselect)
          : [];
        newSelectedCollections = selectedCollections.filter(
          (k: string) => k !== key && !descendantKeys.includes(k)
        );
      } else {
        newSelectedCollections = [...selectedCollections, key];
      }
    }

    paramsState.router.push(
      paramsState.createQueryString(paramsState.pathname, [
        ["collections", newSelectedCollections.join(",")],
        ["page", "1"],
      ])
    );
  };

  return {
    hierarchy,
    handleCheckboxChange,
    selectedCollections,
  };
}
