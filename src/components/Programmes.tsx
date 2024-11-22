"use client";

import { Accordion, AccordionItem } from "@nextui-org/react";
import { Checkbox } from "./nextui/Checkbox";
import { CollectionsGetResponse } from "@/app/api/collections/route";
import { useMemo, useState } from "react";
import { useParamsState } from "@/hooks/useParamsState";
import {
  buildHierarchy,
  calculateNumItemsRecursively,
  ColllectionHierarchy,
  getDescendantKeys,
  recursiveFind,
} from "@/lib/collections";
import { Skeleton } from "./nextui/Skeleton";
import { GrConfigure } from "react-icons/gr";

function Hierarchy({
  collectionData,
  collections,
  selectedCollections,
  onCheckboxChange,
}: {
  collectionData: ColllectionHierarchy;
  collections: ColllectionHierarchy[];
  selectedCollections: string[];
  onCheckboxChange: (key: string) => void;
}) {
  const children = collectionData.children || [];
  const level = collectionData.level || 0;
  const isSelected = selectedCollections.includes(collectionData.key);

  return (
    <>
      <Checkbox
        size={collectionData.level !== 0 ? "lg" : undefined}
        isSelected={isSelected}
        onValueChange={() => onCheckboxChange(collectionData.key)}
        style={{ marginLeft: `${(level) * 16}px` }}
      >
        {collectionData.name} ({collectionData.numItems})
      </Checkbox>
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
    return buildHierarchy(data.collections as ColllectionHierarchy[]);
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
        ["page", "1"],
      ]),
      { scroll: false }
    );
  };

  console.log(
    "DEFAULT EXPANDED KEYS",
    hierarchy.map((c) => c.key)
  );

  console.log("Data", data);

  return (
    <div className="w-[456px] shrink-0">
      <Skeleton className="w-full min-h-screen rounded-2xl" isLoaded={!!data}>
        {hierarchy && hierarchy.length > 0 ? (
          <Accordion
            defaultExpandedKeys={hierarchy.map((c) => c.key)}
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
            {hierarchy
              .map((collection) => (
                <AccordionItem
                  key={collection.key}
                  title={collection.title || collection.name}
                >
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
        ) : (
          <div className="text-lg bg-white dark:bg-white/[2%] p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 h-screen select-none">
            <GrConfigure className="stroke-current size-6" />
            <span>No facets configured.</span>
          </div>
        )}
      </Skeleton>
    </div>
  );
}
