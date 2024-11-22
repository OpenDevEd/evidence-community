"use client";

import { Accordion, AccordionItem } from "@nextui-org/react";
import { Checkbox } from "./nextui/Checkbox";
import { CollectionsGetResponse } from "@/app/api/collections/route";
import { useMemo, useState } from "react";
import { InferSelectModel } from "drizzle-orm";
import { collection } from "@/db/schema/tables/collection";
import { useParamsState } from "@/hooks/useParamsState";
import {
  buildHierarchy,
  calculateNumItemsRecursively,
  CollectionWithChildren,
  getDescendantKeys,
  recursiveFind,
} from "@/lib/collections";

function Hierarchy({
  collectionData,
  collections,
  selectedCollections,
  onCheckboxChange,
}: {
  collectionData: CollectionWithChildren;
  collections: CollectionWithChildren[];
  selectedCollections: string[];
  onCheckboxChange: (key: string) => void;
}) {
  const children = collectionData.children || [];
  const level = collectionData.level || 0;
  const isSelected = selectedCollections.includes(collectionData.key);

  return (
    <>
      {level !== 0 && (
        <Checkbox
          isSelected={isSelected}
          onValueChange={() => onCheckboxChange(collectionData.key)}
          style={{ marginLeft: `${(level - 1) * 16}px` }}
        >
          {collectionData.name} (
          {calculateNumItemsRecursively(collectionData, collections)})
        </Checkbox>
      )}
      {(isSelected || level === 0) &&
        children.map((child) => (
          <Hierarchy
            key={child.key}
            collectionData={child}
            collections={collections}
            selectedCollections={selectedCollections}
            onCheckboxChange={onCheckboxChange}
          />
        ))}
    </>
  );
}

export default function Programmes({
  data,
}: {
  data: CollectionsGetResponse | undefined;
}) {
  const { searchParams, router, pathname, createQueryString } =
    useParamsState();

  const selectedCollections = searchParams.get("collections")?.split(",") || [];

  const hierarchy = useMemo(() => {
    if (!data) return [];
    return buildHierarchy(data.collections as CollectionWithChildren[]);
  }, [data]);

  const handleCheckboxChange = (key: string) => {
    const alreadySelected = selectedCollections.includes(key);
    let newSelectedCollections;

    if (alreadySelected) {
      const collectionToDeselect = recursiveFind(key, hierarchy);

      const descendantKeys = collectionToDeselect
        ? getDescendantKeys(collectionToDeselect)
        : [];
      console.log(descendantKeys);
      newSelectedCollections = selectedCollections.filter(
        (k) => k !== key && !descendantKeys.includes(k)
      );
    } else {
      newSelectedCollections = [...selectedCollections, key];
    }

    router.push(
      createQueryString(pathname, [
        ["collections", newSelectedCollections.join(",")],
      ]),
      { scroll: false }
    );
  };

  return (
    <div className="w-[456px] shrink-0">
      {data && (
        <Accordion
          defaultExpandedKeys={["1", "2", "3", "4"]}
          selectionMode="multiple"
          fullWidth={false}
          variant="shadow"
          className="bg-white dark:bg-white/[2%] p-6 rounded-xl shadow-none"
          itemClasses={{
            title: "text-black/80 dark:text-white/80 font-base text-2xl",
            indicator: "text-black/80 dark:text-white/80",
            trigger: "p-0",
            base: "mb-4 last:mb-0",
            content: "pt-4",
          }}
          showDivider={false}
        >
          {hierarchy.map((collection) => (
            <AccordionItem key={collection.id} title={collection.name}>
              <div className="flex flex-col gap-4">
                <Hierarchy
                  collectionData={collection}
                  collections={hierarchy}
                  selectedCollections={selectedCollections}
                  onCheckboxChange={handleCheckboxChange}
                />
              </div>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
