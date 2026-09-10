"use client";
import { useState } from "react";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import { Switch } from "@/components/nextui/Switch";
import { Mail01Icon, Calendar03Icon, Tick01Icon, BookOpen01Icon } from "@hugeicons/core-free-icons";
import { SectionTitle } from "@/components/typography/SectionTitle";
import { Card } from "@/components/nextui/Card";
import { Icon, muted } from "./DigestPrimitives";
import { changeSubscription, subscriptionError } from "./subscription-client";
export type Preferences = { email: string; weekly: boolean; instant: boolean; confirmed: boolean };
type SubscriptionProps = { initial: Preferences; preferences?: boolean; token?: string; schedule: string };
type Step = "form" | "confirm" | "subscribed" | "stopped";
function PreferenceChoices({ value, onChange, schedule }: { value: Preferences; onChange: (value: Preferences) => void; schedule: string }) {
  return <div className="space-y-5">
    {([
      { key: "weekly", icon: Calendar03Icon, label: "Weekly digest", help: schedule },
      { key: "instant", icon: BookOpen01Icon, label: "New publications", help: "Updates when publications are added" },
    ] as const).map(option => <div key={option.key} className="flex items-center gap-3">
      <span className={muted}><Icon value={option.icon} /></span>
      <div className="min-w-0 flex-1"><label htmlFor={`updates-${option.key}`} className="cursor-pointer text-sm font-semibold text-black/90 dark:text-white/90">{option.label}</label><p className={`mt-0.5 text-xs ${muted}`}>{option.help}</p></div>
      <Switch id={`updates-${option.key}`} aria-label={option.label} color="accent" isSelected={value[option.key]} onValueChange={checked => onChange({ ...value, [option.key]: checked })} />
    </div>)}
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
      await changeSubscription(preferences ? {action: "preferences", token, weekly: next.weekly, instant: next.instant} : {action: "subscribe", email: next.email, weekly: next.weekly, instant: next.instant});
      setValue(next); setStep(nextStep);
    } catch (error) {setError(subscriptionError(error));}
    finally {setBusy(false);}
  }
  const change = (next: Preferences) => {setValue(next); setStep("form");};
  return {value, step, error, busy, setStep, persist, change, hasSelection: value.weekly || value.instant};
}
type FormModel = ReturnType<typeof useSubscriptionForm>;
function savedStep(preferences: boolean, value: Preferences): Step {
  if (!preferences) return "confirm";
  return value.weekly || value.instant ? "subscribed" : "stopped";
}
function SubscriptionEmail({preferences, model}: {preferences: boolean; model: FormModel}) {
  const {value, change} = model;
  if (preferences) return <p className={`break-all text-sm ${muted}`}>{value.email}</p>;
  return <div className="space-y-2"><label htmlFor="digest-email" className="block text-sm font-semibold text-black/90 dark:text-white/90">Email address</label><Input id="digest-email" aria-label="Email address" type="email" isRequired value={value.email} onValueChange={email => change({...value, email})} placeholder="you@example.org" classNames={{ inputWrapper: "h-11 rounded-xl", input: "text-sm" }} /></div>;
}
function SubscriptionButtons({preferences, model}: {preferences: boolean; model: FormModel}) {
  const {value, busy, persist} = model;
  const appearance = preferences ? {width: "", icon: Tick01Icon, label: "Save preferences", empty: false} : {width: "w-full", icon: Mail01Icon, label: "Subscribe", empty: !model.hasSelection};
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="submit" color="accent" size="md" className={`shrink-0 whitespace-nowrap rounded-xl ${appearance.width}`} isLoading={busy} isDisabled={busy || appearance.empty}><Icon value={appearance.icon} size={16} />{appearance.label}</Button>
    {preferences && <Button size="md" className="shrink-0 whitespace-nowrap rounded-xl" onPress={() => persist({ ...value, weekly: false, instant: false, confirmed: false }, "stopped")}>Unsubscribe from all</Button>}
  </div>;
}
function SubscriptionForm({preferences, schedule, model}: {preferences: boolean; schedule: string; model: FormModel}) {
  const {value, step, persist, change} = model;
  return <form className="space-y-6" onSubmit={event => {event.preventDefault();void persist({...value, confirmed: preferences}, savedStep(preferences, value));}}>
    <SubscriptionEmail preferences={preferences} model={model} />
    <PreferenceChoices schedule={schedule} value={value} onChange={change} />
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
  const appearance = preferences ? {color: "transparent", className: "border-0 p-0"} as const : {color: "card", className: "p-5"} as const;
  return <Card as="section" id="subscribe" aria-label="Email updates" color={appearance.color} shadow="none" className={appearance.className}>
    {!preferences && <><SectionTitle className="mb-2 flex items-center gap-2 text-xl"><span className="text-accent"><Icon value={Mail01Icon} /></span>Email updates</SectionTitle><p className={`mb-6 text-xs leading-5 ${muted}`}>Choose how often you hear from this library.</p></>}
    <SubscriptionBody preferences={preferences} schedule={schedule} model={model} />
    {model.error && <p role="alert" className="mt-3 text-sm text-danger">{model.error}</p>}
  </Card>;
}
