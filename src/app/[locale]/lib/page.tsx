import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Metadata } from "next";
import { buildSiteUrl } from "@/lib/site-url";

export async function libraryMetadata(props: {
  pathname: string;
}): Promise<Metadata> {
  const atomUrl = buildSiteUrl(`${props.pathname}/atom.xml`);
  return {
    generator: "new-el",
    alternates: {
      types: {
        "application/atom+xml": atomUrl
      }
    }
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return libraryMetadata({
    pathname: "/lib"
  });
}

export default async function Lib() {
  return (
    <EvidenceLibrary />
  );
}
