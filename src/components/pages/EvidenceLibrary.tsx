"use client";
import { Button } from "@/components/nextui/Button";
import Resource from "@/components/Resource";
import Programmes from "@/components/Programmes";
import { IoSearch } from "react-icons/io5";
import { LuHelpCircle } from "react-icons/lu";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Card } from "@/components/nextui/Card";
import { Switch } from "@/components/nextui/Switch";
import { ScrollShadow, Skeleton } from "@nextui-org/react";
import { Pagination } from "@/components/nextui/Pagination";
import { HiOutlineDownload, HiOutlinePrinter } from "react-icons/hi";
import { HiOutlineCodeBracketSquare } from "react-icons/hi2";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import { Suspense, useCallback, useRef, useState } from "react";
import { ItemsGetResponse } from "@/app/api/items/route";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const ITEM_PER_PAGE = 20;

function ContentInteractions({
  data,
  sort,
  onSortChange,
  abstract,
  onAbstractChange,
}: {
  data: ItemsGetResponse | undefined;
  sort: string;
  onSortChange: (sort: any) => void;
  abstract: boolean;
  onAbstractChange: (abstract: boolean) => void;
}) {
  return (
    <>
      <div className="flex w-full justify-between items-end h-12">
        <h1 className="text-black dark:text-white/60 font-medium text-3xl">
          Search
        </h1>
        <div className="flex gap-4 h-12 flex-1 justify-end">
          <Button
            className="h-full px-6 font-medium text-base"
            endContent={<LuHelpCircle className="size-6" />}
          >
            Help
          </Button>
          <Select
            items={[
              { key: "asc", name: "Newest" },
              { key: "desc", name: "Oldest" },
            ]}
            selectedKeys={sort && [sort]}
            onSelectionChange={onSortChange}
            startContent={
              <div className="text-black/80 dark:text-white/60 shrink-0 font-medium">
                Sort by:
              </div>
            }
          >
            {(item: any) => {
              return <SelectItem key={item.key}>{item.name}</SelectItem>;
            }}
          </Select>
        </div>
      </div>
      <div className="flex gap-4">
        <Input
          placeholder="Search"
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

function ResourcesList({ data, abstract }: { data: ItemsGetResponse | undefined; abstract: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-6">
        {Array.from({ length: ITEM_PER_PAGE }).map(
          (_, index) =>
            (!data || (data && data.items[index])) && (
              <Resource key={index} itemData={data?.items[index]} abstract={abstract} />
            )
        )}
      </div>
    </>
  );
}

function ContentActions() {
  return (
    <div className="flex justify-end mt-6 gap-4">
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
  totalPages,
}: {
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
}) {
  return (
    <div className="w-full flex justify-center sticky bottom-0 bg-background_light dark:bg-background py-6">
      <Skeleton
        isLoaded={totalPages > 0}
        className="w-full h-14 rounded-2xl flex items-center justify-center"
      >
        {totalPages > 0 && (
          <Pagination
            page={page}
            onChange={setPage}
            siblings={3}
            total={totalPages}
          />
        )}
      </Skeleton>
    </div>
  );
}

function MainContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const pageNumber = Number(searchParams.get("page")) || 1;
  const sort = searchParams.get("sort") || "asc";
  const search = searchParams.get("search") || "";

  const [abstract, setAbstract] = useState(true);
  const lastData = useRef<ItemsGetResponse | undefined>(undefined);

  const { data, error, isLoading } = useSWR<ItemsGetResponse>(
    `/items?page=${pageNumber}&limit=${ITEM_PER_PAGE}&sort=${sort}&search=${search}`,
    fetcher,
    {
      onSuccess: (data) => {
        lastData.current = data;
      },
    }
  );

  const createQueryString = useCallback(
    (pathname: string, newParams: [string, string][]) => {
      const params = new URLSearchParams(searchParams.toString());
      newParams.forEach(([name, value]) => {
        if (value) {
          params.set(name, value);
        } else {
          params.delete(name);
        }
      });
      return `${pathname}?${params.toString()}`;
    },
    [searchParams]
  );

  const handlePageChange = (newPage: number) => {
    router.push(createQueryString(pathname, [["page", String(newPage)]]));
  };

  const handleSortChange = (sort: Set<string>) => {
    const value = sort.values().next().value;
    if (value) router.push(createQueryString(pathname, [["sort", value]]));
  };

  return (
    <div className="w-full flex flex-col gap-4">
      <ContentInteractions
        sort={sort}
        onSortChange={handleSortChange}
        data={lastData.current}
        abstract={abstract}
        onAbstractChange={setAbstract}
      />
      <ResourcesList data={data} abstract={abstract} />
      <PaginationControls
        page={pageNumber}
        setPage={handlePageChange}
        totalPages={lastData.current?.totalPages || 0}
      />
      <ContentActions />
      <div className="text-end text-black/40 dark:text-white/40 text-sm">
        Last update from database: 30/03/2024, 15:01 (UTC)
      </div>
    </div>
  );
}

export default function EvidenceLibrary() {
  return (
    <main className="w-full max-w-screen-2xl px-14">
      <div className="flex gap-[40px]">
        <Programmes />
        <MainContent />
      </div>
    </main>
  );
}
