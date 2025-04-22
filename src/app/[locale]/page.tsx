import { redirect } from "@/i18n/routing";
import Landing from "@/components/pages/Landing";
export default async function Home(props: { params: Promise<{ locale: string }>   }) {
  return <Landing />;
}
