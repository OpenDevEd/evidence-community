import { getCachedStatus } from "@/app/api/cache";
import About, { FAQSection } from "@/components/pages/About";

export default async function AboutPage() {
    const status = await getCachedStatus();

    const data = (status?.links?.find((link: Record<string, any>) => link.help)?.help || {
        items: []
    }) as FAQSection;

    return (
        <About faqData={data} />
    )
}