"use client";
import { useState } from "react";
import { changeSubscription, subscriptionError } from "./subscription-client";
import Link from "next/link";
import { Button } from "@/components/nextui/Button";
import PageContainer from "@/components/layout/PageContainer";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Mail01Icon, Tick01Icon } from "@hugeicons/core-free-icons";

export default function SubscriptionAction({token, action, locale}: {token: string; action: "confirm" | "unsubscribe"; locale: string}) {
  const [state, setState] = useState<"ready" | "saving" | "done">("ready");
  const [error, setError] = useState("");
  async function save() {
    setState("saving"); setError("");
    try {
      await changeSubscription(action === "confirm" ? {action, token} : {action: "preferences", token, weekly: false, instant: false});
      setState("done");
    } catch (error) {setError(subscriptionError(error));setState("ready");}
  }
  const text = actionText[action];
  return <PageContainer className="mx-auto max-w-3xl"><Link href={`/${locale}/digests`} className="text-sm text-accent">All digests</Link><header className="mb-8 mt-7"><h1 className="text-3xl font-bold">{state === "done" ? text.done : text.heading}</h1></header>{state === "done" ? <p className="flex items-center gap-2 text-sm"><HugeiconsIcon icon={Tick01Icon} size={18} />{text.message}</p> : <Button color="accent" size="md" className="rounded-xl" isLoading={state === "saving"} onPress={save}><HugeiconsIcon icon={Mail01Icon} size={18} />{text.button}</Button>}{error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}</PageContainer>;
}

const actionText = {
  confirm: {heading: "Confirm email updates", done: "Subscription confirmed", message: "Your email preferences are active.", button: "Confirm subscription"},
  unsubscribe: {heading: "Stop email updates", done: "Unsubscribed", message: "All emails from this library are switched off.", button: "Unsubscribe from all"},
};
