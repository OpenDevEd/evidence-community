import type { Metadata, Viewport } from "next";
import BaseLayout from "@/components/layout/Base";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

// Library theme and consent are resolved before this shared document renders.
// Next.js reads this route export. Fallow does not recognize it yet.
// fallow-ignore-next-line unused-export
export const instant = false;

export function generateStaticParams() {
    return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout(
    props: Readonly<{
        children: React.ReactNode;
        params: Promise<{ [key: string]: any }>;
    }>
) {
    const params = await props.params;

    const {
        locale
    } = params;

    const {
        children
    } = props;

    // Ensure that the incoming `locale` is valid
    if (!routing.locales.includes(locale as any)) {
		notFound();
	}

    // Enable static rendering
    setRequestLocale(locale);

    return <BaseLayout locale={locale}>{children}</BaseLayout>;
}
