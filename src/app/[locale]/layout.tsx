import type { Metadata, Viewport } from "next";
import BaseLayout from "@/components/layout/Base";
import { routing } from "@/i18n/routing";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

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
