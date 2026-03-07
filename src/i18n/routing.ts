import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

const defaultLocales = ["en-GB", "en-US", "de", "ar", "hi", "fr", "cn", "sw", "pt"];
const locales = process.env.NEXT_PUBLIC_ONLY_LOCALE ? [process.env.NEXT_PUBLIC_ONLY_LOCALE] : defaultLocales;
const localeDetection = process.env.NEXT_PUBLIC_LOCALE_DETECTION !== undefined ? process.env.NEXT_PUBLIC_LOCALE_DETECTION === "true" : false;
const defaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE as any || 'en-GB';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localeDetection,
  localeCookie: false,
  localePrefix: "as-needed"
});

export const localesNames = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  de: "Deutsch",
  ar: "العربية",
  hi: "हिंदी",
  fr: "Français",
  cn: "中文",
  sw: "Swahili",
  pt: "Português",
};

export const shortLocalesNames = {
  "en-US": "EN-US",
  "en-GB": "EN-GB",
  de: "DE",
  ar: "AR",
  hi: "HI",
  fr: "FR",
  cn: "CN",
  sw: "SW",
  pt: "PT",
};

export const {Link, getPathname, redirect, usePathname, useRouter} =
  createNavigation(routing);
