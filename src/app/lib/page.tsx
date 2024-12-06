import EvidenceLibrary from "@/components/pages/EvidenceLibrary";

export default async function Lib({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  return (
    <EvidenceLibrary searchParams={searchParams} />
  );
}
