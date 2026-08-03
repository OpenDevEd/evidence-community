import Script from "next/script";

export default function ConsentDefaultsScript() {
	return (
		<Script id="ga-consent-default" strategy="beforeInteractive">
			{`
				window.dataLayer = window.dataLayer || [];
				window.gtag =
					window.gtag ||
					function gtag(){window.dataLayer.push(arguments);}
				window.gtag('consent', 'default', {
					analytics_storage: 'denied',
					ad_storage: 'denied',
					ad_user_data: 'denied',
					ad_personalization: 'denied',
					wait_for_update: 500
				});
			`}
		</Script>
	);
}
