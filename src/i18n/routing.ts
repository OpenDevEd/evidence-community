import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

 
export const routing = defineRouting({
  locales: ["en-GB", "en-US", "de", "ar", "hi", "fr", "cn", "sw", "pt"],
  defaultLocale: 'en-GB',
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