import { Link, Skeleton } from "@nextui-org/react";
import AboutUs from "./icons/AboutUs";
import { twMerge } from "tailwind-merge";
import { InferSelectModel } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { firstNonNullOrEmpty } from "@/lib/lib";

function ResourceDivider() {
  return <div className="text-black/80 dark:text-white/60">|</div>;
}

function ResourceData({
  startContent,
  classNames,
  text,
}: {
  startContent?: React.ReactNode;
  classNames?: {
    container?: string;
    text?: string;
  };
  text: string;
}) {
  return (
    <div className={twMerge("flex gap-2 items-center", classNames?.container)}>
      {startContent}
      <span
        className={twMerge(
          "text-black/60 dark:text-white/60 font-medium text-lg line-clamp-1",
          classNames?.text
        )}
      >
        {text}
      </span>
    </div>
  );
}

export default function Resource({
  itemData,
}: {
  itemData: InferSelectModel<typeof item>;
}) {
  return (
    <div className="w-full bg-white dark:bg-white/[4%] rounded-xl p-6 flex flex-col gap-4">
      <Skeleton isLoaded={!!itemData} className="w-full min-h-8 rounded-2xl">
        <h1 className="capitalize text-2xl text-black/80 dark:text-white/80 line-clamp-2">
          {itemData?.title}
        </h1>
      </Skeleton>
      <Skeleton isLoaded={!!itemData} className="w-full min-h-8 rounded-2xl">
        <div className="flex w-full gap-2 items-center flex-wrap">
          <ResourceData
            startContent={<AboutUs className="fill-accent size-6" />}
            text="Open Development & Education"
          />
          <ResourceDivider />
          <ResourceData
            text="Mar 26th, 2024"
            classNames={{
              text: "text-black/60 dark:text-white/60 font-normal",
            }}
          />
          <ResourceDivider />
          <div className="bg-accent rounded-lg px-4 py-1 text-white/80 font-medium">
            In Progress
          </div>
        </div>
      </Skeleton>
      <Skeleton isLoaded={!!itemData} className={twMerge("w-full min-h-0 rounded-2xl ", !itemData ? "min-h-20" : "min-h-0")}>
        <p className="text-black/60 dark:text-white/60 line-clamp-3 text-lg w-full break-all">
          {itemData && firstNonNullOrEmpty(itemData, [
            "fullTextPDF",
            "abstractNote",
          ])}
        </p>
      </Skeleton>
      <Skeleton isLoaded={!!itemData} className="w-1/2 rounded-2xl">
        <Link showAnchorIcon href="/" className="font-medium text-tertiary-400">
          <span className="text-black/60 dark:text-white/60 ">
          view on docs.opendeved.net
          </span>
        </Link>
      </Skeleton>
    </div>
  );
}
