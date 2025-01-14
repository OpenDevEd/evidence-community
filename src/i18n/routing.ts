import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

 
export const routing = defineRouting({
  locales: ["en-GB", "en-US", "de", "ar", "hi", "fr", "cn"],
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
};

export const shortLocalesNames = {
  "en-US": "EN-US",
  "en-GB": "EN-GB",
  de: "DE",
  ar: "AR",
  hi: "HI",
  fr: "FR",
  cn: "CN",
};

export const {Link, getPathname, redirect, usePathname, useRouter} =
  createNavigation(routing);