"use client";
import { Button } from "@/components/nextui/Button";
import Resource from "@/components/Resource";
import Programmes from "@/components/Programmes";
import { IoSearch } from "react-icons/io5";
import { LuChevronLeft, LuHelpCircle, LuX } from "react-icons/lu";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ScrollShadow,
  useDisclosure,
} from "@nextui-org/react";
import { Pagination } from "@/components/nextui/Pagination";
import { HiOutlineDownload, HiOutlinePrinter } from "react-icons/hi";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { useCallback, useEffect, useRef, useState } from "react";
import { ItemsGetResponse } from "@/app/api/items/route";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { Skeleton } from "@/components/nextui/Skeleton";
import { CollectionsGetResponse } from "@/app/api/collections/route";
import { useParamsState } from "@/hooks/useParamsState";
import { FaSort, FaTrash } from "react-icons/fa";
import { BiCompass } from "react-icons/bi";
import { AiOutlineCompass } from "react-icons/ai";
import { useHierarchy } from "@/hooks/useHierarchy";
import useBreakpoint from "@/lib/useBreakpoint";
import { useDebounce } from "@/hooks/useDebounce";
import { ColllectionHierarchy } from "@/lib/collections";
import { AnimatePresence, motion } from "framer-motion";
import { twMerge } from "tailwind-merge";

const ITEM_PER_PAGE = 20;

function ContentInteractions({
  data,
  sort,
  onSortChange,
  search,
  onSearchChange,
  abstract,
  onAbstractChange,
  collectionsData,
  selectedCollections,
  handleCheckboxChange,
  hierarchy,
}: {
  data: ItemsGetResponse | undefined;
  sort: string;
  onSortChange: (sort: any) => void;
  search: string;
  onSearchChange: (search: string) => void;
  abstract: boolean;
  onAbstractChange: (abstract: boolean) => void;
  collectionsData: CollectionsGetResponse | undefined;
} & ReturnType<typeof useHierarchy>) {
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const debouncedSearch = useDebounce(onSearchChange, 200);

  return (
    <>
      <div className="flex w-full flex-col xl:flex-row xl:justify-between xl:items-end h-28 xl:h-12 gap-4">
        <h1 className="text-black dark:text-white/60 font-medium text-3xl w-full xl:w-auto h-12 flex justify-between items-end">
          Search
          <Button
            startContent={<AiOutlineCompass className="size-6" />}
            className="xl:hidden ml-auto"
            onClick={onOpen}
          >
            Explore
          </Button>
          <Modal
            hideCloseButton
            classNames={{
              base: "bg-background_light dark:bg-background",
              wrapper: "no-scrollbar",
            }}
            scrollBehavior="outside"
            isOpen={isOpen}
            onOpenChange={onOpenChange}
          >
            <ModalContent>
              {(onClose) => (
                <>
                  <ModalHeader className="text-black dark:text-white/60 flex justify-center items-center gap-4 text-2xl ">
                    <AiOutlineCompass className="size-8" />
                    Explore
                    <Button
                      className="ml-auto"
                      onClick={onClose}
                      isIconOnly
                      startContent={<LuX className="size-6" />}
                    />
                  </ModalHeader>
                  <Programmes
                    data={collectionsData}
                    handleCheckboxChange={handleCheckboxChange}
                    selectedCollections={selectedCollections}
                    hierarchy={hierarchy}
                    isModal
                  />
                </>
              )}
            </ModalContent>
          </Modal>
        </h1>
        <div className="flex gap-4 h-12 flex-1 justify-end">
          <Button
            className="h-full xl:px-6 px-0 font-medium text-base flex-1 xl:flex-none"
            endContent={<LuHelpCircle className="size-6" />}
          >
            Help
          </Button>
          <Select
            items={[
              { key: "desc", name: "Newest" },
              { key: "asc", name: "Oldest" },
            ]}
            selectedKeys={sort && [sort]}
            onSelectionChange={onSortChange}
            startContent={
              <>
                <div className="text-black/80 dark:text-white/60 shrink-0 font-medium hidden xl:block">
                  Sort by:
                </div>
                <FaSort className="size-6 xl:hidden" />
              </>
            }
          >
            {(item: any) => {
              return <SelectItem key={item.key}>{item.name}</SelectItem>;
            }}
          </Select>
        </div>
      </div>
      <div className="flex flex-col xl:flex-row gap-4">
        <Input
          defaultValue={search}
          onChange={(e) => debouncedSearch(e.target.value)}
          placeholder="Search"
          size="lg"
          isClearable
          startContent={
            <IoSearch className="size-6 fill-current text-black/60 dark:text-white/40" />
          }
        />
        <Select
          items={[
            { key: "authors", name: "in authors or contributors" },
            { key: "title", name: "in title" },
          ]}
          defaultSelectedKeys={["authors"]}
          color="tertiary"
          size="md"
          classNames={{
            base: "xl:max-w-72 w-full max-w-full",
          }}
        >
          {(item: any) => {
            return <SelectItem key={item.key}>{item.name}</SelectItem>;
          }}
        </Select>
      </div>
      <div className="flex justify-between gap-4">
        <Skeleton
          isLoaded={!!data}
          className="flex items-center flex-1 rounded-2xl"
        >
          <h2 className="text-black dark:text-white/80 text-lg leading-[1.125rem] flex items-center gap-2">
            <span className="text-2xl leading-6">
              {data?.totalItems.toLocaleString()}
            </span>
            Resources
          </h2>
        </Skeleton>
        <Card>
          <div className="px-3">
            <Switch
              size="sm"
              isSelected={abstract}
              onValueChange={onAbstractChange}
              classNames={{
                base: "flex-row-reverse",
              }}
            >
              Abstract
            </Switch>
          </div>
        </Card>
      </div>
      <div className="gap-4 w-full max-w-full h-12 relative hidden">
        <ScrollShadow
          orientation="horizontal"
          className="flex gap-4 overflow-y-hidden overflow-x-scroll absolute inset-0"
        >
          {[
            { label: "2 Implementation Guidance", count: 6 },
            { label: "3 Resources: TPD Implementation", count: 3 },
            { label: "1 Programme Reports", count: 3 },
            { label: "1 Programme Reports", count: 3 },
            { label: "Outputs Registry", count: 7 },
          ].map((item, index) => (
            <Button size="xs" variant="solid" className="shrink-0" key={index}>
              {item.label}
              <span className="text-black/80 dark:text-white/40 font-medium text-sm leading-3">
                {`(${item.count})`}
              </span>
            </Button>
          ))}
        </ScrollShadow>
      </div>
    </>
  );
}

function ResourcesList({
  data,
  isLoading,
  abstract,
}: {
  data: ItemsGetResponse | undefined;
  isLoading: boolean;
  abstract: boolean;
}) {
  const actuallyNoData = !isLoading && data && data.items.length === 0;

  return (
    <>
      <div className="flex flex-col gap-6 -mt-4">
        {actuallyNoData ? (
          <div className="text-center text-black/40 dark:text-white/40 text-sm">
            No resources found
          </div>
        ) : (
          Array.from({ length: ITEM_PER_PAGE }).map(
            (_, index) =>
              (!data || (data && data.items[index])) && (
                <Resource
                  key={index}
                  itemData={data?.items[index]}
                  abstract={abstract}
                  isLoading={isLoading}
                />
              )
          )
        )}
      </div>
    </>
  );
}

function ContentActions() {
  return (
    <div className="xl:flex xl:justify-end grid gap-4 flex-wrap">
      <Button endContent={<HiOutlineDownload className="size-6" />}>
        Download 6,788 Records
      </Button>
      <Button endContent={<HiOutlinePrinter className="size-6" />}>
        Print 5,654 Citations
      </Button>
      <Button endContent={<HiOutlineCodeBracketSquare className="size-6" />}>
        Main Feed
      </Button>
    </div>
  );
}

function PaginationControls({
  page,
  setPage,
  data,
  isLoading,
}: {
  page: number;
  setPage: (page: number) => void;
  data: ItemsGetResponse | undefined;
  isLoading: boolean;
}) {
  const totalPages = data?.totalPages || 0;
  const actuallyNoData = !isLoading && data && data.items.length === 0;
  const isDesktop = useBreakpoint("xl");

  return (
    !actuallyNoData && (
      <div className="w-full flex justify-center sticky bottom-0 bg-background_light dark:bg-background py-6 z-10">
        <Skeleton
          isLoaded={totalPages > 0}
          className="w-full h-14 rounded-2xl flex items-center justify-center"
        >
          {totalPages > 0 && (
            <Pagination
              page={page}
              onChange={setPage}
              siblings={isDesktop ? 3 : 0}
              total={totalPages}
            />
          )}
        </Skeleton>
      </div>
    )
  );
}

function FilterChips({
  collections,
  handleCheckboxChange,
  collectionsData,
}: {
  collections: string[];
  handleCheckboxChange: (key: string) => void;
  collectionsData: CollectionsGetResponse | undefined;
}) {
  return (
      <div className={twMerge("flex max-h-0 overflow-y-hidden transition-all duration-200 opacity-0 mb-0", collections.length > 0 && "max-h-[512px] mb-4 opacity-100")}>
        <div className="flex-1 flex gap-2 flex-wrap">
          <AnimatePresence>
            {collectionsData &&
              collections.map((collection: string, index) => {
                const collectionData = collectionsData.collections.find(
                  (c) => c.key === collection
                );

                return (
                  <motion.div
                    key={collection}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Button
                      size="xs"
                      variant="solid"
                      className="shrink-0"
                      onClick={() => {
                        handleCheckboxChange(collection);
                      }}
                    >
                      {collectionData?.name}
                      <span className="text-black/80 dark:text-white/40 font-medium text-sm leading-3">
                        {`(${collectionData?.numItems})`}
                      </span>
                    </Button>
                  </motion.div>
                );
              })}
          </AnimatePresence>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="w-8 flex justify-end"
        > 
          <Button
            onClick={() => {
              handleCheckboxChange("");
            }}
            isIconOnly
            size="sm"
            variant="solid"
            color="accent"
          >
            <FaTrash className="text-white size-3" />
          </Button>
        </motion.div>
      </div>
    
  );
}

function MainContent() {
  const { searchParams, router, pathname, createQueryString } =
    useParamsState();

  const pageNumber = Number(searchParams.get("page")) || 1;
  const sort = searchParams.get("sort") || "desc";
  const search = searchParams.get("search") || "";
  const collections = searchParams.get("collections")?.split(",") || [];

  const [abstract, setAbstract] = useState(true);

  const handlePageChange = useCallback(
    (newPage: number) => {
      router.push(createQueryString(pathname, [["page", String(newPage)]]));
    },
    [router, pathname, createQueryString]
  );

  const handleSortChange = useCallback(
    (sort: Set<string>) => {
      const value = sort.values().next().value;
      if (value) router.push(createQueryString(pathname, [["sort", value]]));
    },
    [router, pathname, createQueryString]
  );

  const handleSearchChange = useCallback(
    (text: string) =>
      router.push(
        createQueryString(pathname, [
          ["search", text],
          ["page", "1"],
        ])
      ),
    [router, pathname, createQueryString]
  );

  const {
    data: itemsData,
    error: itemsError,
    isLoading: isItemsLoading,
  } = useSWR<ItemsGetResponse>(
    `/items?page=${pageNumber}&limit=${ITEM_PER_PAGE}&sort=${sort}${
      collections.length > 0 ? `&collections=${collections.join(",")}` : ""
    }${search.length > 0 ? `&search=${search}` : ""}`,
    fetcher,
    {
      keepPreviousData: true,
      onSuccess: (data) => {
        if (data.totalPages < pageNumber) {
          handlePageChange(data.totalPages);
        }
      },
    }
  );

  const {
    data: collectionsData,
    error: collectionsError,
    isLoading: isCollectionsLoading,
  } = useSWR<CollectionsGetResponse>("/collections", fetcher);

  const { hierarchy, handleCheckboxChange, selectedCollections } = useHierarchy(
    {
      data: collectionsData,
    }
  );

  return (
    <>
      <Programmes
        data={collectionsData}
        handleCheckboxChange={handleCheckboxChange}
        selectedCollections={selectedCollections}
        hierarchy={hierarchy}
      />
      <div className="w-full flex flex-col gap-4">
        <ContentInteractions
          sort={sort}
          search={search}
          onSearchChange={handleSearchChange}
          onSortChange={handleSortChange}
          data={itemsData}
          abstract={abstract}
          onAbstractChange={setAbstract}
          selectedCollections={selectedCollections}
          handleCheckboxChange={handleCheckboxChange}
          collectionsData={collectionsData}
          hierarchy={hierarchy}
        />
        <FilterChips
          collections={selectedCollections}
          handleCheckboxChange={handleCheckboxChange}
          collectionsData={collectionsData}
        />
        <ResourcesList
          data={itemsData}
          isLoading={isItemsLoading}
          abstract={abstract}
        />
        <PaginationControls
          page={pageNumber}
          setPage={handlePageChange}
          data={itemsData}
          isLoading={isItemsLoading}
        />
        <ContentActions />
        <div className="text-end text-black/40 dark:text-white/40 text-sm">
          Last update from database: 30/03/2024, 15:01 (UTC)
        </div>
      </div>
    </>
  );
}

export default function EvidenceLibrary() {
  return (
    <main className="w-full max-w-screen-2xl px-4 xl:px-14">
      <div className="flex gap-[40px] flex-col xl:flex-row">
        <MainContent />
      </div>
    </main>
  );
}
