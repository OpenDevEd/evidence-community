import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { redirect } from "next/navigation";

export default async function Home() {
  redirect("/lib");

  return null;
}
