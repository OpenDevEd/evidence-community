"use client";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { changeSubscription, subscriptionError } from "./subscription-client";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/nextui/Button";
import PageContainer from "@/components/layout/PageContainer";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Mail01Icon, Tick01Icon } from "@hugeicons/core-free-icons";

// The token is only needed when the reader presses the button, so the page never waits for it.
export default function SubscriptionAction({token: pending, action, locale}: {token: Promise<string>; action: "confirm" | "unsubscribe"; locale: string}) {
  const t = useTranslations("digests");
  const [state, setState] = useState<"ready" | "saving" | "done">("ready");
  const [error, setError] = useState("");
  async function save() {
    setState("saving"); setError("");
    try {
      const token = await pending;
      await changeSubscription(action === "confirm" ? {action, token} : {action: "preferences", token, digest: false, instant: false});
      setState("done");
    } catch (error) {setError(subscriptionError(error, t("couldNotSave")));setState("ready");}
  }
  const text = {heading: t(`action.${action}.heading`), done: t(`action.${action}.done`), message: t(`action.${action}.message`), button: t(`action.${action}.button`)};
  return <PageContainer className="mx-auto max-w-3xl"><Link href="/digests" className="text-sm text-accent">{t("allDigests")}</Link><header className="mb-8 mt-7"><h1 className="text-3xl font-bold">{state === "done" ? text.done : text.heading}</h1></header>{state === "done" ? <p className="flex items-center gap-2 text-sm"><HugeiconsIcon icon={Tick01Icon} size={18} />{text.message}</p> : <Button color="accent" size="md" className="rounded-xl" isLoading={state === "saving"} onPress={save}><HugeiconsIcon icon={Mail01Icon} size={18} />{text.button}</Button>}{error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}</PageContainer>;
}

