import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Metadata } from "next";

export async function libraryMetadata(props: {
  pathname: string;
}): Promise<Metadata> {
  const atomUrl = new URL(`${props.pathname}/atom.xml`, process.env.BASE_URL!);
  return {
    generator: "new-el",
    alternates: {
      types: {
        "application/atom+xml": atomUrl.toString()
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
