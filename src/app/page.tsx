import EvidenceLibrary from "@/components/pages/EvidenceLibrary";
import { Suspense } from "react";

export default async function Home() {
  return (
    <Suspense>
      <EvidenceLibrary />
    </Suspense>
  );
}
