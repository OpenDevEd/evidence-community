"use client";

import { Accordion, AccordionItem } from "@nextui-org/react";
import { Checkbox } from "./nextui/Checkbox";
import { useEffect, useRef, useState } from "react";
import { useParamsState } from "@/hooks/useParamsState";
import {
  buildHierarchy,
  calculateNumItemsRecursively,
  getDescendantKeys,
  recursiveFind,
} from "@/lib/collections";
import { Skeleton } from "./nextui/Skeleton";
import { GrConfigure } from "react-icons/gr";
import { useHierarchy } from "@/hooks/useHierarchy";
import { twMerge } from "tailwind-merge";
import { IoMdArrowDropdown } from "react-icons/io";
import { Button } from "./nextui/Button";
import { motion } from "framer-motion";
import { AnimatePresence } from "framer-motion";
import { LuChevronDown } from "react-icons/lu";
import { CollectionsGetResponse, Collection } from "@/app/api/collections/types";

const MAX_COLLAPSED_HEIGHT = 400;

function Hierarchy({
  collectionData,
  collections,
  selectedCollections,
  onCheckboxChange,
}: {
  collectionData: Collection;
  collections: Collection[];
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

function Category({
  collection,
  hierarchy,
  selectedCollections,
  handleCheckboxChange,
}: {
  collection: Collection;
  hierarchy: Collection[];
  selectedCollections: string[];
  handleCheckboxChange: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [showMore, setShowMore] = useState(false);
  const previousShowMore = useRef(showMore);

  useEffect(() => {
    const apply = () => {
      if (ref.current) {
        setShowMore((prev) => {
          previousShowMore.current = prev;
          if (!ref.current) return prev;
          return ref.current.scrollHeight > (MAX_COLLAPSED_HEIGHT);
        });
      }
    };

    const observer = new MutationObserver(apply);
    if (ref.current) {
      observer.observe(ref.current, { childList: true, subtree: true });
    }
    apply();
    return () => {
      observer.disconnect();
    };
  }, [ref]);


  return (
    <div className="relative">
      <div
        style={{
          maxHeight: expanded
            ? `${(ref.current?.scrollHeight ?? MAX_COLLAPSED_HEIGHT) + 200}px`
            : `${MAX_COLLAPSED_HEIGHT}px`,
        }}
        className={twMerge(
          "flex flex-col gap-4 overflow-hidden transition-all duration-200 pb-0",
        )}
        ref={ref}
      >
        <Hierarchy
          collectionData={collection}
          collections={hierarchy}
          selectedCollections={selectedCollections}
          onCheckboxChange={handleCheckboxChange}
        />
      </div>
      <div className={twMerge("transition-all duration-200 pb-0", expanded && showMore && "pb-16")}>
      </div>
      <AnimatePresence mode="wait">
        {showMore && (
          <motion.div
            initial={previousShowMore.current == false ? { opacity: 0 } : { opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={twMerge(
              "absolute bottom-0 w-full bg-white dark:bg-card z-10",
              "before:absolute before:-top-24 before:left-0 before:right-0 before:h-24 before:bg-gradient-to-t from-white dark:before:from-card before:to-transparent before:z-10 before:opacity-100 before:transition-opacity duration-400 before:pointer-events-none",
              expanded && "before:opacity-0"
            )}
            key={"show-more"}
          >
            <Button
              className="w-full"
              endContent={
                <LuChevronDown
                  className={twMerge(expanded && "rotate-180")}
                />
              }
              onPress={() => setExpanded(!expanded)}
            >
              {expanded ? "See Less" : "See More"}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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
      <Skeleton
        className="w-full xl:min-h-screen rounded-2xl"
        isLoaded={!!data}
      >
        {hierarchy && hierarchy.length > 0 ? (
          <Accordion
            defaultExpandedKeys={hierarchy.map((c) => c.key)}
            selectionMode="multiple"
            fullWidth={false}
            variant="shadow"
            className="bg-white dark:bg-card p-6 rounded-xl shadow-none"
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
              <AccordionItem
                key={collection.key}
                title={collection.title || collection.name}
              >
                <Category
                  collection={collection}
                  hierarchy={hierarchy}
                  selectedCollections={selectedCollections}
                  handleCheckboxChange={handleCheckboxChange}
                />
              </AccordionItem>
            ))}
          </Accordion>
        ) : (
          <div className="text-lg bg-white dark:bg-card p-6 rounded-xl shadow-none text-black/80 dark:text-white/80 font-medium flex justify-center items-center gap-2 xl:h-screen select-none">
            <GrConfigure className="stroke-current size-6" />
            <span>No facets configured.</span>
          </div>
        )}
      </Skeleton>
    </div>
  );
}
