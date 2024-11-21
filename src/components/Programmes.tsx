"use client";

import { Accordion, AccordionItem, CheckboxGroup } from "@nextui-org/react";
import { Checkbox } from "./nextui/Checkbox";
import AboutUs from "./icons/AboutUs";
import { BiCheck, BiDownArrow } from "react-icons/bi";
import { Button } from "./nextui/Button";
import { VscChevronDown, VscChevronLeft } from "react-icons/vsc";
import { fetcher } from "@/lib/fetcher";
import { CollectionsGetResponse } from "@/app/api/collections/route";
import useSWR from "swr";
import { useMemo, useState } from "react";
import { InferSelectModel } from "drizzle-orm";
import { collection } from "@/db/schema/tables/collection";

type Collection = InferSelectModel<typeof collection>;

function calculateNumItemsRecursively(
  collection: Collection,
  collections: Collection[]
): number {
  const children = collections.filter(
    (c) => c.parentCollection === collection.key
  );
  return (
    (collection.numItems || 0) +
    children.reduce(
      (acc, child) => acc + calculateNumItemsRecursively(child, collections),
      0
    )
  );
}

function Hierarchy({
  level,
  collectionData,
  collections,
}: {
  level: number;
  collectionData: Collection;
  collections: Collection[];
}) {
  const children = useMemo(() => {
    return collections.filter((c) => c.parentCollection === collectionData.key);
  }, [collectionData, collections]);
  const [showChildren, setShowChildren] = useState(level === 0);

  return (
    <>
      {level !== 0 && (
        <Checkbox
          onClick={() => setShowChildren(!showChildren)}
          style={{ marginLeft: `${(level - 1) * 16}px` }}
        >
          {collectionData.name} (
          {calculateNumItemsRecursively(collectionData, collections)})
        </Checkbox>
      )}
      {showChildren &&
        children.map((child) => (
          <Hierarchy
            key={child.key}
            level={level + 1}
            collectionData={child}
            collections={collections}
          />
        ))}
    </>
  );
}

export default function Programmes() {
  const { data, isLoading } = useSWR<CollectionsGetResponse>(
    "/collections",
    fetcher
  );

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
          {data?.collections
            .filter((collection: any) => collection.parentCollection === null)
            .map((collection: any) => (
              <AccordionItem key={collection.id} title={collection.name}>
                <div className="flex flex-col gap-4">
                  <Hierarchy
                    level={0}
                    collectionData={collection}
                    collections={data?.collections as Collection[]}
                  />
                </div>
              </AccordionItem>
            ))}
        </Accordion>
      )}
    </div>
  );
}
