import type { SVGProps } from "react";

// Brand mark from the OpenScholar project (openscholar.ai). The original SVG's
// glow filter is intentionally omitted: it is a blur filter and invisible at
// small sizes.
const OpenScholar = (props: SVGProps<SVGSVGElement>) => (
	<svg viewBox="0 0 150 150" xmlns="http://www.w3.org/2000/svg" {...props}>
		<title>OpenScholar</title>
		<defs>
			<linearGradient
				id="openscholar-gradient"
				x1="0%"
				y1="0%"
				x2="100%"
				y2="0%"
			>
				<stop offset="0%" stopColor="#ffb347" />
				<stop offset="100%" stopColor="#ff6b35" />
			</linearGradient>
		</defs>
		<g
			stroke="url(#openscholar-gradient)"
			strokeWidth="5"
			fill="none"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<path d="M 10 117.5 L 10 37.5 Q 10 17.5 30 22.5 L 75 32.5 L 120 22.5 Q 140 17.5 140 37.5 L 140 117.5 Q 140 132.5 120 127.5 L 75 117.5 L 30 127.5 Q 10 132.5 10 117.5 Z" />
			<path d="M 75 117.5 L 75 32.5" />
			<path d="M 40 57.5 L 40 72.5 L 55 87.5" />
			<path d="M 55 47.5 L 65 57.5 L 65 97.5" />
			<path d="M 40 92.5 L 50 102.5" />
			<path d="M 110 57.5 L 110 72.5 L 95 87.5" />
			<path d="M 95 47.5 L 85 57.5 L 85 97.5" />
			<path d="M 110 92.5 L 100 102.5" />
		</g>
		<g fill="url(#openscholar-gradient)">
			<circle cx="40" cy="57.5" r="4" />
			<circle cx="55" cy="87.5" r="4" />
			<circle cx="55" cy="47.5" r="4" />
			<circle cx="65" cy="97.5" r="4" />
			<circle cx="40" cy="92.5" r="4" />
			<circle cx="50" cy="102.5" r="4" />
			<circle cx="110" cy="57.5" r="4" />
			<circle cx="95" cy="87.5" r="4" />
			<circle cx="95" cy="47.5" r="4" />
			<circle cx="85" cy="97.5" r="4" />
			<circle cx="110" cy="92.5" r="4" />
			<circle cx="100" cy="102.5" r="4" />
		</g>
	</svg>
);

export default OpenScholar;
