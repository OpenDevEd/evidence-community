import {defineRouting} from 'next-intl/routing';
import {createNavigation} from 'next-intl/navigation';

 
export const routing = defineRouting({
  locales: ["en", "de", "ar", "hi", "fr", "cn"],
  defaultLocale: 'en',
});

export const localesNames = {
	en: "English",
	de: "Deutsch",
	ar: "العربية",
	hi: "हिंदी",
	fr: "Français",
  cn: "中文",
};


// export type Pathnames = keyof typeof routing.pathnames;
export type Locale = (typeof routing.locales)[number];

export const {Link, getPathname, redirect, usePathname, useRouter} =
  createNavigation(routing);