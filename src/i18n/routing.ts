import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

 
export const routing = defineRouting({
  locales: ["en-US", "en-GB", "de", "ar", "hi", "fr", "cn"],
  defaultLocale: 'en-US',
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

export const {Link, getPathname, redirect, usePathname, useRouter} =
  createNavigation(routing);