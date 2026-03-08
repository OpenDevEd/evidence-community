# Cookies

## **How {{SITE_HOST}} uses cookies**

When you browse {{SITE_HOST}}, small data files called cookies may be stored on your device. These files help websites function properly and provide insights to website owners about how their sites are being used. Below, we explain which cookies {{SITE_HOST}} uses and their purposes.

## **Strictly necessary cookies**

These cookies are essential for the website to function correctly. They do not require your consent and cannot be disabled through our cookie settings.

| **Name** | **Owner** | **Purpose** | **Expires** |
| --- | --- | --- | --- |
| `analytics_consent` | {{SITE_HOST}} | Stores your analytics consent choice (`pending`, `granted`, or `denied`). This cookie gates the loading of PostHog and Google Analytics — neither tool loads until a choice is recorded. | 180 days |
| `NEXT_LOCALE` | {{SITE_HOST}} / Next.js | Stores your language preference for localised routing, ensuring you see content in your chosen language. | Browser session |
| `__cf_bm` | Cloudflare | Used by Cloudflare for bot management and abuse detection to protect {{SITE_HOST}} from automated threats. | Short-lived (Cloudflare-managed) |
| `_cfuvid` | Cloudflare | Distinguishes individual visitors sharing the same IP address, enabling accurate rate limiting and security controls. | Short-lived (Cloudflare-managed) |
| `__client` | Clerk | Long-lived session cookie used to maintain authenticated sessions in production. | Clerk-managed |
| `__client_uat` | Clerk | Session freshness cookie used to verify whether a session is still valid. | Clerk-managed |
| `__session` | Clerk | Short-lived session token used to validate authenticated requests. | Clerk-managed |

## **Performance and analytics cookies (optional)**

These cookies are only set **after you have granted consent** via our cookie banner. If you decline or later withdraw consent, these cookies are not created — and any previously set cookies of this type are cleared.

| **Name** | **Purpose** | **Expires** |
| --- | --- | --- |
| `_ga`, `_ga_*` | We use Google Analytics to measure how people interact with our website. These cookies distinguish users and sessions for analytics measurement, including visit attribution and traffic reporting. All data is collected pseudonymously — we never identify you personally. {{SITE_HOST}} does not employ third-party tracking technologies or sell your information to advertising companies. | Google-managed (up to 2 years) |
| `ph_*` | We use PostHog analytics software to learn how people interact with our website. This helps us create better reports and enhance user experience. The cookie contains an anonymous device identifier, your browsing session details, and your initial landing page. All data is collected anonymously — we never identify you personally. {{SITE_HOST}} doesn't employ third-party tracking technologies or sell your information to advertising companies. | PostHog-managed (up to 365 days) |

### **What data is contained in the PostHog cookie?**

The PostHog cookie saves the following details in a structured format:

- **$device_id**: A unique random code (UUID) assigned to your device
- **distinct_id**: An anonymous identifier for tracking purposes. Initially identical to your device ID, but may link to your account if you log in
- **$sesid**: Details about your current browsing session, including when it started, a unique session identifier, and recent activity timestamps
- **$epp**: Technical flags used by PostHog for internal features
- **$initial_person_info**: Records showing how you arrived at our site (such as from a search engine or direct visit) and which page you landed on first

This cookie contains no information that can identify you personally, such as your name, email, or other private details.

### **Local storage (analytics, optional)**

In addition to cookies, our analytics tools use your browser's local storage after consent is granted. This data stays on your device and is not transmitted separately to our servers.

| **Name** | **Owner** | **Purpose** | **Retention** |
| --- | --- | --- | --- |
| `ph_*`, `posthog*`, `posthog-opted` | PostHog | Client-side analytics persistence for consented PostHog sessions. Cleared if consent is withdrawn. | Until cleared or rotated by PostHog |
| `utm:active` | {{SITE_HOST}} | Stores active campaign attribution (e.g. campaign source, medium) to help us understand how visitors arrive at our site. Only persisted after consent is granted. | 30 days |
| `lastFetchedData` | {{SITE_HOST}} | Caches recently fetched library data locally to improve client-side continuity. | Until cleared or replaced |

### **Additional data collected by analytics tools**

Beyond the cookies themselves, PostHog and Google Analytics gather supplementary information automatically. Client-side event collection is limited to `page_view` and `attachment_interaction` events — autocapture is disabled and URLs are sanitised before collection.

**Technical details about your device and browser:**
- Which browser you're using and its version number
- Your device's operating system
- Whether you're on a desktop, mobile phone, or tablet
- Your screen's display resolution
- Technical browser identification string (user agent)

**Approximate geographic information:**
- Your IP address (used only to estimate location, not saved in cookies)
- General location such as country, city, or region (calculated from IP address)
- Your local timezone setting

**How you navigate our website:**
- Which pages you view during your visit
- The website you came from (referrer)

**Information we deliberately exclude:**
- Text you type into forms
- Login credentials or passwords
- Payment or credit card details
- Any other private or sensitive personal information
- Third-party advertising cookies are not used
- Your data is never sold to advertisers or marketing companies

## **Managing your cookie preferences**

You can update your cookie preferences at any time by clicking the "Cookie settings" link available in the footer of every page on {{SITE_HOST}}.

Additionally, all major web browsers provide settings to control cookies. For comprehensive information about cookies and how to view which ones are stored on your device, visit [www.aboutcookies.org](http://www.aboutcookies.org/) or [www.allaboutcookies.org](http://www.allaboutcookies.org/).

### **Browser-specific cookie management guides:**

- [Google Chrome](https://support.google.com/accounts/answer/61416?co=GENIE.Platform%3DDesktop&hl=en)
- [Microsoft Edge](https://privacy.microsoft.com/en-us/windows-10-microsoft-edge-and-privacy)
- [Mozilla Firefox](https://support.mozilla.org/en-US/kb/enable-and-disable-cookies-website-preferences)
- [Microsoft Internet Explorer](https://support.microsoft.com/en-gb/help/17442/windows-internet-explorer-delete-manage-cookies)
- [Opera](https://www.opera.com/help/tutorials/security/privacy/)
- [Apple Safari](https://support.apple.com/en-gb/safari)

For other browsers, check the support documentation provided by your browser's developer.

### **Removing the {{SITE_HOST}} cookie from your device**

You can remove analytics cookies whenever you like using your browser's settings:

**Google Chrome:**
1. Select the three-dot menu (⋮) in the upper right
2. Navigate to Settings → Privacy and security → Cookies and other site data
3. Select "See all cookies and site data"
4. Type "{{SITE_HOST}}" in the search box
5. Click the delete icon next to any analytics cookies

**Mozilla Firefox:**
1. Open the menu (≡) and choose Settings
2. Navigate to Privacy & Security → Cookies and Site Data
3. Select "Manage Data"
4. Type "{{SITE_HOST}}" to find the cookies
5. Highlight them and select "Remove Selected"

**Apple Safari:**
1. Open Safari → Preferences → Privacy
2. Select "Manage Website Data"
3. Type "{{SITE_HOST}}" in the search field
4. Choose the entry and select "Remove"

**Microsoft Edge:**
1. Click the three-dot menu (⋯) in the upper right
2. Go to Settings → Cookies and site permissions → Cookies and site data
3. Choose "See all cookies and site data"
4. Search for "{{SITE_HOST}}"
5. Click the delete icon

### **Preventing analytics cookies from being set**

If you'd prefer to stop our analytics cookies from being created:

1. **Use our cookie settings**: Click "Cookie settings" in the footer of any {{SITE_HOST}} page to decline or withdraw consent — analytics tools will not load and any existing cookies will be cleared
2. **Disable all cookies**: Configure your browser to reject all cookies (note: this may impact how other websites work)
3. **Block only third-party cookies**: This stops external trackers while allowing our first-party analytics cookie — this won't block the {{SITE_HOST}} cookie
4. **Install privacy browser extensions**: Privacy-focused tools like Privacy Badger or uBlock Origin can prevent analytics cookies
5. **Enable Do Not Track**: {{SITE_HOST}} honours DNT signals — if you enable DNT in your browser, PostHog will not track your session

### **Get in touch**

For questions about our cookie practices, please reach out to us:

**Email**: contact@opendeved.net

**Last updated**: March 6, 2026
