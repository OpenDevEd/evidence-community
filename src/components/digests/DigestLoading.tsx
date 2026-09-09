import PageContainer from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/nextui/Skeleton";

export default function DigestLoading() {
  return (
    <PageContainer className="mx-auto min-h-screen" aria-busy="true" aria-label="Loading digest">
      <div aria-hidden="true" className="space-y-8 py-8">
        <Skeleton className="h-5 w-28 rounded-lg" />
        <div className="grid items-start gap-8 lg:grid-cols-12">
          <div className="space-y-8 lg:col-span-8 xl:col-span-9">
            <Skeleton className="h-14 w-3/4 rounded-xl" />
            <Skeleton className="h-4 w-44 rounded-lg" />
            <div className="space-y-4 pt-4">
              <Skeleton className="h-6 w-1/2 rounded-lg" />
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-full rounded-lg" />
              <Skeleton className="h-4 w-4/5 rounded-lg" />
            </div>
          </div>
          <Skeleton className="h-64 rounded-2xl lg:col-span-4 xl:col-span-3" />
        </div>
      </div>
    </PageContainer>
  );
}
