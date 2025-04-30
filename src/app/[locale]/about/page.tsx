import { getCachedStatus } from "@/app/api/cache";
import About, { FAQSection } from "@/components/pages/About";
import { notFound } from "next/navigation";

export default async function AboutPage() {
    const status = await getCachedStatus();

    const data = (status?.links?.find((link: Record<string, any>) => link.help)?.help || {
        items: []
    }) as FAQSection;

    if (data.items.length === 0) {
        return notFound();
    }

    return (
        <About faqData={data} />
    )
}