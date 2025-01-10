import { redirect } from "@/i18n/routing";

export default async function Home(props: { params: Promise<{ locale: string }>   }) {
  const params = await props.params;

  const {
    locale
  } = params;

  redirect({
    href: "/lib",
    locale: locale,
  });

  return null;
}
