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
import { useHierarchy } from "@/hooks/useHierarchy";
import { twMerge } from "tailwind-merge";

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
      {collectionData.level !== 0 && (
        <Checkbox
          size={collectionData.level !== 1 ? "lg" : undefined}
          isSelected={isSelected}
          onValueChange={() => onCheckboxChange(collectionData.key)}
          style={{ marginLeft: `${(level - 1) * 16}px` }}
      >
          {collectionData.name} ({collectionData.numItems})
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
  handleCheckboxChange,
  selectedCollections,
  hierarchy,
  isModal = false,
}: {
  data: CollectionsGetResponse | undefined;
  handleCheckboxChange: (key: string) => void;
  selectedCollections: string[];
  isModal?: boolean;
} & ReturnType<typeof useHierarchy>) {
  const { searchParams, router, pathname, createQueryString } =
    useParamsState();

  return (
    <div
      className={twMerge(
        "w-full xl:w-[456px] shrink-0",
        isModal ? "block" : "hidden xl:block"
      )}
    >
      <Skeleton className="w-full xl:min-h-screen rounded-2xl" isLoaded={!!data}>
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
          <div className="text-lg bg-white dark:bg-white/[2%] p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 xl:h-screen select-none">
            <GrConfigure className="stroke-current size-6" />
            <span>No facets configured.</span>
          </div>
        )}
      </Skeleton>
    </div>
  );
}
