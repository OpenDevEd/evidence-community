"use client";
import { useState } from "react";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Switch } from "@/components/nextui/Switch";
import { Mail01Icon, Calendar03Icon, Tick01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import { SidebarCard } from "@/components/features/collections/SidebarCard";
import { Icon, muted } from "./DigestPrimitives";
import { changeSubscription, subscriptionError } from "./subscription-client";
export type Preferences = { email: string; digest: boolean; instant: boolean; confirmed: boolean };
type SubscriptionProps = { initial: Preferences; preferences?: boolean; token?: string; schedule: string };
type Step = "form" | "confirm" | "subscribed" | "stopped";
function PreferenceChoices({ value, onChange, schedule, busy }: { value: Preferences; onChange: (value: Preferences) => void; schedule: string; busy: boolean }) {
  return <div className="space-y-5">
    {([
      { key: "digest", icon: Calendar03Icon, label: "Library digests", help: schedule },
      { key: "instant", icon: BookOpen01Icon, label: "New publications", help: "Updates when publications are added" },
    ] as const).map(option => <Switch key={option.key} name={option.key} aria-labelledby={`updates-${option.key}-label`} aria-describedby={`updates-${option.key}-help`} color="accent" isDisabled={busy} isSelected={value[option.key]} onValueChange={checked => onChange({ ...value, [option.key]: checked })} classNames={{base: "h-auto w-full max-w-none items-start gap-3", wrapper: "mt-0.5", label: "min-w-0 flex-1"}}>
      {/* The icon belongs to the title row; the description runs full width beneath it. */}
      <span className="flex items-center gap-2"><span className={muted}><Icon value={option.icon} size={16} /></span><span id={`updates-${option.key}-label`} className="text-sm font-semibold text-black/90 dark:text-white/90">{option.label}</span></span>
      <span id={`updates-${option.key}-help`} className={`mt-1 block text-xs font-normal ${muted}`}>{option.help}</span>
    </Switch>)}
  </div>;
}
function useSubscriptionForm({initial, preferences, token}: SubscriptionProps) {
  const [value, setValue] = useState(initial);
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function persist(next: Preferences, nextStep: Step) {
    setBusy(true); setError("");
    try {
      await changeSubscription(preferences ? {action: "preferences", token, digest: next.digest, instant: next.instant} : {action: "subscribe", email: next.email, digest: next.digest, instant: next.instant});
      setValue(next); setStep(nextStep);
    } catch (error) {setError(subscriptionError(error));}
    finally {setBusy(false);}
  }
  const change = (next: Preferences) => {setValue(next); setStep("form"); setError("");};
  return {value, step, error, busy, setStep, persist, change, hasSelection: value.digest || value.instant};
}
type FormModel = ReturnType<typeof useSubscriptionForm>;
function savedStep(preferences: boolean, value: Preferences): Step {
  if (!preferences) return "confirm";
  return value.digest || value.instant ? "subscribed" : "stopped";
}
function SubscriptionEmail({preferences, model}: {preferences: boolean; model: FormModel}) {
  const {value, change} = model;
  if (preferences) return <p className={`break-all text-sm ${muted}`}>{value.email}</p>;
  return <div className="space-y-2"><label htmlFor="digest-email" className="block text-sm font-semibold text-black/90 dark:text-white/90">Email address</label><Input id="digest-email" aria-label="Email address" type="email" isRequired isDisabled={model.busy} value={value.email} onValueChange={email => change({...value, email})} placeholder="you@example.org" classNames={{ inputWrapper: "h-11 rounded-xl", input: "text-sm" }} /></div>;
}
function SubscriptionButtons({preferences, model}: {preferences: boolean; model: FormModel}) {
  const {value, busy, persist} = model;
  const appearance = preferences ? {width: "", icon: Tick01Icon, label: "Save preferences", empty: false} : {width: "w-full", icon: Mail01Icon, label: "Subscribe", empty: !model.hasSelection};
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="submit" color="accent" size="md" className={`shrink-0 whitespace-nowrap rounded-xl ${appearance.width}`} isLoading={busy} isDisabled={busy || appearance.empty}><Icon value={appearance.icon} size={16} />{appearance.label}</Button>
    {preferences && <Button size="md" className="shrink-0 whitespace-nowrap rounded-xl" isDisabled={busy} onPress={() => persist({ ...value, digest: false, instant: false, confirmed: false }, "stopped")}>Unsubscribe from all</Button>}
  </div>;
}
function SubscriptionForm({preferences, schedule, model}: {preferences: boolean; schedule: string; model: FormModel}) {
  const {value, step, persist, change} = model;
  return <form className="space-y-6" onSubmit={event => {event.preventDefault();void persist({...value, confirmed: preferences}, savedStep(preferences, value));}}>
    <SubscriptionEmail preferences={preferences} model={model} />
    <PreferenceChoices schedule={schedule} value={value} onChange={change} busy={model.busy} />
    <SubscriptionButtons preferences={preferences} model={model} />
    {step === "subscribed" && <p role="status" className="flex items-center gap-2 text-sm"><Icon value={Tick01Icon} size={16} />Preferences saved</p>}
    {!preferences && <p className={`text-xs ${muted}`}>No account needed. Unsubscribe in any email.</p>}
  </form>;
}
function SubscriptionBody({preferences, schedule, model}: {preferences: boolean; schedule: string; model: FormModel}) {
  const {step, value, setStep} = model;
  if (step === "confirm") return <div className="space-y-4" role="status"><h3 className="text-base font-semibold">Check your email</h3><p className={`text-sm leading-6 ${muted}`}>If this address needs confirmation, you’ll receive a link at <span className="break-all font-medium text-black dark:text-white">{value.email}</span>.</p><Button size="sm" variant="transparent" onPress={() => setStep("form")}>Change email</Button></div>;
  if (step === "stopped") return <div className="space-y-4" role="status"><h2 className="flex items-center gap-2 text-lg font-semibold"><Icon value={Tick01Icon} />Unsubscribed</h2><p className={`text-sm ${muted}`}>All library emails are switched off.</p><Button size="md" className="rounded-xl" onPress={() => setStep("form")}>Change preferences</Button></div>;
  return <SubscriptionForm preferences={preferences} schedule={schedule} model={model} />;
}
export function Subscription(props: SubscriptionProps) {
  const {preferences = false, schedule} = props;
  const model = useSubscriptionForm(props);
  const body = <>
    <SubscriptionBody preferences={preferences} schedule={schedule} model={model} />
    {model.error && <p role="alert" className="-mt-2 text-sm text-danger">{model.error}</p>}
  </>;
  if (preferences) return <section aria-label="Email updates">{body}</section>;
  // The library sidebar's card, so the form sits in the page the way the library's filters do.
  return <div id="subscribe" className="h-full scroll-mt-8 [&>section]:h-full"><SidebarCard title="Email updates" band={<p className={`text-sm ${muted}`}>Choose how often you hear from this library.</p>}>{body}</SidebarCard></div>;
}
