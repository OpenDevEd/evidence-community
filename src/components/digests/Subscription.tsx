"use client";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@nextui-org/react";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Switch } from "@/components/nextui/Switch";
import { Mail01Icon, Calendar03Icon, Tick01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import { SidebarCard } from "@/components/features/collections/SidebarCard";
import { Icon, muted } from "./DigestPrimitives";
import { changeSubscription, subscriptionError } from "./subscription-client";
export type Preferences = { email: string; digest: boolean; instant: boolean; confirmed: boolean };
/** A reader who has not subscribed yet: digests on, as the page they are reading is one. */
export const newReader: Preferences = {email: "", digest: true, instant: false, confirmed: false};
type SubscriptionProps = { initial: Preferences; preferences?: boolean; token?: string; schedule: string; /** The form alone, for a popover that frames it. */ bare?: boolean };
type Step = "form" | "confirm" | "subscribed" | "stopped";
function PreferenceChoices({ id, value, onChange, schedule, busy }: { id: string; value: Preferences; onChange: (value: Preferences) => void; schedule: string; busy: boolean }) {
  const t = useTranslations("digests");
  return <div className="space-y-5">
    {([
      { key: "digest", icon: Calendar03Icon, label: t("libraryDigests"), help: schedule },
      { key: "instant", icon: BookOpen01Icon, label: t("newPublications"), help: t("updatesWhenAdded") },
    ] as const).map(option => <Switch key={option.key} name={option.key} aria-labelledby={`${id}-${option.key}-label`} aria-describedby={`${id}-${option.key}-help`} color="accent" isDisabled={busy} isSelected={value[option.key]} onValueChange={checked => onChange({ ...value, [option.key]: checked })} classNames={{base: "h-auto w-full max-w-none items-start gap-3", wrapper: "mt-0.5", label: "min-w-0 flex-1"}}>
      {/* The icon belongs to the title row; the description runs full width beneath it. */}
      <span className="flex items-center gap-2"><span className={muted}><Icon value={option.icon} size={16} /></span><span id={`${id}-${option.key}-label`} className="text-sm font-semibold text-black/90 dark:text-white/90">{option.label}</span></span>
      <span id={`${id}-${option.key}-help`} className={`mt-1 block text-xs font-normal ${muted}`}>{option.help}</span>
    </Switch>)}
  </div>;
}
function useSubscriptionForm({initial, preferences, token}: SubscriptionProps) {
  const t = useTranslations("digests");
  const [value, setValue] = useState(initial);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The form can be on the page twice, in its card and in a popover, so its fields take their ids from here.
  const id = useId();
  async function persist(next: Preferences, nextStep: Step) {
    setBusy(true); setError("");
    try {
      await changeSubscription(preferences ? {action: "preferences", token, digest: next.digest, instant: next.instant} : {action: "subscribe", email: next.email, digest: next.digest, instant: next.instant});
      setValue(next); setStep(nextStep);
    } catch (error) {setError(subscriptionError(error, t("couldNotSave")));}
    finally {setBusy(false);}
  }
  const change = (next: Preferences) => {setValue(next); setStep("form"); setError("");};
  return {id, value, step, error, busy, setStep, persist, change, hasSelection: value.digest || value.instant};
}
type FormModel = ReturnType<typeof useSubscriptionForm>;
function savedStep(preferences: boolean, value: Preferences): Step {
  if (!preferences) return "confirm";
  return value.digest || value.instant ? "subscribed" : "stopped";
}
function SubscriptionEmail({preferences, model}: {preferences: boolean; model: FormModel}) {
  const t = useTranslations("digests");
  const {value, change} = model;
  if (preferences) return <p className={`break-all text-sm ${muted}`}>{value.email}</p>;
  return <div className="space-y-2"><label htmlFor={`${model.id}-email`} className="block text-sm font-semibold text-black/90 dark:text-white/90">{t("emailAddress")}</label><Input id={`${model.id}-email`} aria-label={t("emailAddress")} type="email" color="card" isRequired isDisabled={model.busy} value={value.email} onValueChange={email => change({...value, email})} placeholder={t("youExampleOrg")} classNames={{ inputWrapper: "h-11 rounded-xl", input: "text-sm" }} /></div>;
}
function SubscriptionButtons({preferences, model}: {preferences: boolean; model: FormModel}) {
  const t = useTranslations("digests");
  const {value, busy, persist} = model;
  const appearance = preferences ? {width: "", icon: Tick01Icon, label: t("savePreferences"), empty: false} : {width: "w-full", icon: Mail01Icon, label: t("subscribe"), empty: !model.hasSelection};
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="submit" color="accent" size="md" className={`shrink-0 whitespace-nowrap rounded-xl ${appearance.width}`} isLoading={busy} isDisabled={busy || appearance.empty}><Icon value={appearance.icon} size={16} />{appearance.label}</Button>
    {preferences && <Button size="md" className="shrink-0 whitespace-nowrap rounded-xl" isDisabled={busy} onPress={() => persist({ ...value, digest: false, instant: false, confirmed: false }, "stopped")}>{t("unsubscribeFromAll")}</Button>}
  </div>;
}
function SubscriptionForm({preferences, schedule, model}: {preferences: boolean; schedule: string; model: FormModel}) {
  const t = useTranslations("digests");
  const {value, step, persist, change} = model;
  return <form className="space-y-6" onSubmit={event => {event.preventDefault();void persist({...value, confirmed: preferences}, savedStep(preferences, value));}}>
    <SubscriptionEmail preferences={preferences} model={model} />
    <PreferenceChoices id={model.id} schedule={schedule} value={value} onChange={change} busy={model.busy} />
    <SubscriptionButtons preferences={preferences} model={model} />
    {step === "subscribed" && <p role="status" className="flex items-center gap-2 text-sm"><Icon value={Tick01Icon} size={16} />{t("preferencesSaved")}</p>}
    {!preferences && <p className={`text-xs ${muted}`}>{t("noAccountNeededUnsubscribeInAny")}</p>}
  </form>;
}
function SubscriptionBody({preferences, schedule, model}: {preferences: boolean; schedule: string; model: FormModel}) {
  const t = useTranslations("digests");
  const {step, value, setStep} = model;
  if (step === "confirm") return <div className="space-y-4" role="status"><h3 className="text-base font-semibold">{t("checkYourEmail")}</h3><p className={`text-sm leading-6 ${muted}`}>{t.rich("linkSent", { email: value.email, strong: (chunks) => <span className="break-all font-medium text-black dark:text-white">{chunks}</span> })}</p><Button size="sm" variant="transparent" onPress={() => setStep("form")}>{t("changeEmail")}</Button></div>;
  if (step === "stopped") return <div className="space-y-4" role="status"><h2 className="flex items-center gap-2 text-lg font-semibold"><Icon value={Tick01Icon} />{t("unsubscribed")}</h2><p className={`text-sm ${muted}`}>{t("allLibraryEmailsAreSwitchedOff")}</p><Button size="md" className="rounded-xl" onPress={() => setStep("form")}>{t("changePreferences")}</Button></div>;
  return <SubscriptionForm preferences={preferences} schedule={schedule} model={model} />;
}
export function Subscription(props: SubscriptionProps) {
  const t = useTranslations("digests");
  const {preferences = false, schedule} = props;
  const model = useSubscriptionForm(props);
  const body = <>
    <SubscriptionBody preferences={preferences} schedule={schedule} model={model} />
    {model.error && <p role="alert" className="-mt-2 text-sm text-danger">{model.error}</p>}
  </>;
  if (preferences || props.bare) return <section aria-label={t("emailUpdates")}>{body}</section>;
  // The library sidebar's card, so the form sits in the page the way the library's filters do.
  return <div id="subscribe" className="h-full scroll-mt-8 [&>section]:h-full"><SidebarCard title={t("emailUpdates")} band={<p className={`text-sm ${muted}`}>{t("chooseHowOftenYouHearFrom")}</p>}>{body}</SidebarCard></div>;
}
/**
 * "Get this digest in your inbox": the subscription form in a popover, where the reader is, so subscribing never takes
 * them away from the edition they are reading.
 */
export function InboxButton({ schedule, placement = "bottom-start" }: { schedule: string; /** The popover lines up with the button's edge nearest the text. */ placement?: "bottom-start" | "bottom-end" }) {
  const t = useTranslations("digests");
  return <Popover placement={placement} shouldCloseOnScroll={false}>
    <PopoverTrigger>
      <Button color="accent" size="md" className="shrink-0 whitespace-nowrap rounded-xl"><Icon value={Mail01Icon} size={16} />{t("getThisDigestInYourInbox")}</Button>
    </PopoverTrigger>
    <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] items-stretch rounded-2xl border border-black/10 bg-white p-5 dark:border-white/10 dark:bg-secondary">
      <Subscription initial={newReader} schedule={schedule} bare />
    </PopoverContent>
  </Popover>;
}
