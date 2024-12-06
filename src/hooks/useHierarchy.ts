import { getDescendantKeys, recursiveFind } from "@/lib/collections";
import { buildHierarchy } from "@/lib/collections";
import { useParamsState } from "./useParamsState";
import { useMemo } from "react";
import { Collection, CollectionsGetResponse } from "@/app/api/collections/types";

export function useHierarchy({
  data,
	searchParams,
}: {
  data: CollectionsGetResponse | undefined;
	searchParams: { [key: string]: any };
}) {
  const { router, pathname, createQueryString } =
    useParamsState(searchParams);

  const selectedCollections = searchParams["collections"]?.split(",") || [];

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
        console.log(descendantKeys);
        newSelectedCollections = selectedCollections.filter(
          (k: string) => k !== key && !descendantKeys.includes(k)
        );
      } else {
        newSelectedCollections = [...selectedCollections, key];
      }
    }

    router.push(
      createQueryString(pathname, [
        ["collections", newSelectedCollections.join(",")],
        ["page", "1"],
      ]),
      { scroll: false }
    );
  };

  return {
    hierarchy,
    handleCheckboxChange,
    selectedCollections,
  };
}
