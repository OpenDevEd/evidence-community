import { redirect } from "@/i18n/routing";

export default async function Home({ params: { locale } }: { params: { locale: string }   }) {
  redirect({
    href: "/lib",
    locale: "en",
  });

  return null;
}
