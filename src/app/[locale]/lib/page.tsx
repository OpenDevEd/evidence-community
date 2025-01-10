import EvidenceLibrary from "@/components/pages/EvidenceLibrary";

export default async function Lib(
  props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }
) {
  const searchParams = await props.searchParams;
  return (
    <EvidenceLibrary searchParams={searchParams} />
  );
}
