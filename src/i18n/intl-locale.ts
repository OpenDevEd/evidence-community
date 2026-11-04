/** The language tag `Intl` knows for a locale. Ours for Chinese, `cn`, isn't one, so `Intl` would use the machine's default language, which differs between the server and the browser. */
export const intlLocale = (locale: string) => (locale === "cn" ? "zh-CN" : locale);
