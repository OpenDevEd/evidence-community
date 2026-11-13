import { searchParamsLoader } from "@/lib/searchParams";

import { inferParserType } from "nuqs/server";

export const countryFacetOptions: {
	key: string;
	label: string;
	action: "handleCountrySelect" | "handleAuthorCountrySelect";
	queryParam: "country" | "author_country";
}[] = [
	{
		key: "country",
		label: "countryFilter",
		action: "handleCountrySelect",
		queryParam: "country",
	},
	{
		key: "authorCountry",
		label: "authorCountries",
		action: "handleAuthorCountrySelect",
		queryParam: "author_country",
	},
];

export const COUNTRIES: Record<string, string> = {
	AF: "Afghanistan",
	AL: "Albania",
	DZ: "Algeria",
	AS: "American Samoa",
	AD: "Andorra",
	AO: "Angola",
	AI: "Anguilla",
	AQ: "Antarctica",
	AG: "Antigua & Barbuda",
	AR: "Argentina",
	AM: "Armenia",
	AW: "Aruba",
	AU: "Australia",
	AT: "Austria",
	AZ: "Azerbaijan",
	BS: "Bahamas",
	BH: "Bahrain",
	BD: "Bangladesh",
	BB: "Barbados",
	BY: "Belarus",
	BE: "Belgium",
	BZ: "Belize",
	BJ: "Benin",
	BM: "Bermuda",
	BT: "Bhutan",
	BO: "Bolivia",
	BQ: "Caribbean Netherlands",
	BA: "Bosnia & Herzegovina",
	BW: "Botswana",
	BV: "Bouvet Island",
	BR: "Brazil",
	IO: "British Indian Ocean Territory",
	BN: "Brunei",
	BG: "Bulgaria",
	BF: "Burkina Faso",
	BI: "Burundi",
	KH: "Cambodia",
	CM: "Cameroon",
	CA: "Canada",
	CV: "Cabo Verde",
	KY: "Cayman Islands",
	CF: "Central African Republic",
	TD: "Chad",
	CL: "Chile",
	CN: "China",
	CX: "Christmas Island",
	CC: "Cocos (Keeling) Islands",
	CO: "Colombia",
	KM: "Comoros",
	CG: "Congo - Brazzaville",
	CD: "Congo - Kinshasa",
	CK: "Cook Islands",
	CR: "Costa Rica",
	CI: "Côte d’Ivoire",
	HR: "Croatia",
	CU: "Cuba",
	CW: "Curaçao",
	CY: "Cyprus",
	CZ: "Czechia",
	DK: "Denmark",
	DJ: "Djibouti",
	DM: "Dominica",
	DO: "Dominican Republic",
	EC: "Ecuador",
	EG: "Egypt",
	SV: "El Salvador",
	GQ: "Equatorial Guinea",
	ER: "Eritrea",
	EE: "Estonia",
	SZ: "Eswatini",
	ET: "Ethiopia",
	FK: "Falkland Islands",
	FO: "Faroe Islands",
	FJ: "Fiji",
	FI: "Finland",
	FR: "France",
	GF: "French Guiana",
	PF: "French Polynesia",
	TF: "French Southern Territories",
	GA: "Gabon",
	GM: "Gambia",
	GE: "Georgia",
	DE: "Germany",
	GH: "Ghana",
	GI: "Gibraltar",
	GR: "Greece",
	GL: "Greenland",
	GD: "Grenada",
	GP: "Guadeloupe",
	GU: "Guam",
	GT: "Guatemala",
	GG: "Guernsey",
	GN: "Guinea",
	GW: "Guinea-Bissau",
	GY: "Guyana",
	HT: "Haiti",
	HM: "Heard & McDonald Islands",
	VA: "Vatican City",
	HN: "Honduras",
	HK: "Hong Kong SAR China",
	HU: "Hungary",
	IS: "Iceland",
	IN: "India",
	ID: "Indonesia",
	IR: "Iran",
	IQ: "Iraq",
	IE: "Ireland",
	IM: "Isle of Man",
	IL: "Israel",
	IT: "Italy",
	JM: "Jamaica",
	JP: "Japan",
	JE: "Jersey",
	JO: "Jordan",
	KZ: "Kazakhstan",
	KE: "Kenya",
	KI: "Kiribati",
	KP: "North Korea",
	KR: "South Korea",
	KW: "Kuwait",
	KG: "Kyrgyzstan",
	LA: "Laos",
	LV: "Latvia",
	LB: "Lebanon",
	LS: "Lesotho",
	LR: "Liberia",
	LY: "Libya",
	LI: "Liechtenstein",
	LT: "Lithuania",
	LU: "Luxembourg",
	MO: "Macao SAR China",
	MK: "North Macedonia",
	MG: "Madagascar",
	MW: "Malawi",
	MY: "Malaysia",
	MV: "Maldives",
	ML: "Mali",
	MT: "Malta",
	MH: "Marshall Islands",
	MQ: "Martinique",
	MR: "Mauritania",
	MU: "Mauritius",
	YT: "Mayotte",
	MX: "Mexico",
	FM: "Micronesia",
	MD: "Moldova",
	MC: "Monaco",
	MN: "Mongolia",
	ME: "Montenegro",
	MS: "Montserrat",
	MA: "Morocco",
	MZ: "Mozambique",
	MM: "Myanmar (Burma)",
	NA: "Namibia",
	NR: "Naoero",
	NP: "Nepal",
	NL: "Netherlands",
	NC: "New Caledonia",
	NZ: "New Zealand",
	NI: "Nicaragua",
	NE: "Niger",
	NG: "Nigeria",
	NU: "Niue",
	NF: "Norfolk Island",
	MP: "Northern Mariana Islands",
	NO: "Norway",
	OM: "Oman",
	PK: "Pakistan",
	PW: "Palau",
	PS: "Palestinian Territories",
	PA: "Panama",
	PG: "Papua New Guinea",
	PY: "Paraguay",
	PE: "Peru",
	PH: "Philippines",
	PN: "Pitcairn Islands",
	PL: "Poland",
	PT: "Portugal",
	PR: "Puerto Rico",
	QA: "Qatar",
	RW: "Rwanda",
	RE: "Réunion",
	RO: "Romania",
	RU: "Russia",
	BL: "St. Barthélemy",
	SH: "St. Helena",
	KN: "St. Kitts & Nevis",
	LC: "St. Lucia",
	MF: "St. Martin",
	PM: "St. Pierre & Miquelon",
	VC: "St. Vincent & Grenadines",
	WS: "Samoa",
	SM: "San Marino",
	ST: "São Tomé & Príncipe",
	SA: "Saudi Arabia",
	SN: "Senegal",
	RS: "Serbia",
	SC: "Seychelles",
	SL: "Sierra Leone",
	SG: "Singapore",
	SX: "Sint Maarten",
	SK: "Slovakia",
	SI: "Slovenia",
	SB: "Solomon Islands",
	SO: "Somalia",
	ZA: "South Africa",
	GS: "South Georgia & South Sandwich Islands",
	SS: "South Sudan",
	ES: "Spain",
	LK: "Sri Lanka",
	SD: "Sudan",
	SR: "Suriname",
	SJ: "Svalbard & Jan Mayen",
	SE: "Sweden",
	CH: "Switzerland",
	SY: "Syria",
	TW: "Taiwan",
	TJ: "Tajikistan",
	TZ: "Tanzania",
	TH: "Thailand",
	TL: "Timor-Leste",
	TG: "Togo",
	TK: "Tokelau",
	TO: "Tonga",
	TT: "Trinidad & Tobago",
	TN: "Tunisia",
	TR: "Türkiye",
	TM: "Turkmenistan",
	TC: "Turks & Caicos Islands",
	TV: "Tuvalu",
	UG: "Uganda",
	UA: "Ukraine",
	AE: "United Arab Emirates",
	GB: "United Kingdom",
	US: "United States",
	UM: "U.S. Outlying Islands",
	UY: "Uruguay",
	UZ: "Uzbekistan",
	VU: "Vanuatu",
	VE: "Venezuela",
	VN: "Vietnam",
	VG: "British Virgin Islands",
	VI: "U.S. Virgin Islands",
	WF: "Wallis & Futuna",
	EH: "Western Sahara",
	YE: "Yemen",
	ZM: "Zambia",
	ZW: "Zimbabwe",
	AX: "Åland Islands",
	XK: "Kosovo",
};


export const A3ToA2: Record<string, string> = {
	AFG: "AF",
	ALB: "AL",
	DZA: "DZ",
	ASM: "AS",
	AND: "AD",
	AGO: "AO",
	AIA: "AI",
	ATA: "AQ",
	ATG: "AG",
	ARG: "AR",
	ARM: "AM",
	ABW: "AW",
	AUS: "AU",
	AUT: "AT",
	AZE: "AZ",
	BHS: "BS",
	BHR: "BH",
	BGD: "BD",
	BRB: "BB",
	BLR: "BY",
	BEL: "BE",
	BLZ: "BZ",
	BEN: "BJ",
	BMU: "BM",
	BTN: "BT",
	BOL: "BO",
	BES: "BQ",
	BIH: "BA",
	BWA: "BW",
	BVT: "BV",
	BRA: "BR",
	IOT: "IO",
	BRN: "BN",
	BGR: "BG",
	BFA: "BF",
	BDI: "BI",
	KHM: "KH",
	CMR: "CM",
	CAN: "CA",
	CPV: "CV",
	CYM: "KY",
	CAF: "CF",
	TCD: "TD",
	CHL: "CL",
	CHN: "CN",
	CXR: "CX",
	CCK: "CC",
	COL: "CO",
	COM: "KM",
	COG: "CG",
	COD: "CD",
	COK: "CK",
	CRI: "CR",
	CIV: "CI",
	HRV: "HR",
	CUB: "CU",
	CUW: "CW",
	CYP: "CY",
	CZE: "CZ",
	DNK: "DK",
	DJI: "DJ",
	DMA: "DM",
	DOM: "DO",
	ECU: "EC",
	EGY: "EG",
	SLV: "SV",
	GNQ: "GQ",
	ERI: "ER",
	EST: "EE",
	SWZ: "SZ",
	ETH: "ET",
	FLK: "FK",
	FRO: "FO",
	FJI: "FJ",
	FIN: "FI",
	FRA: "FR",
	GUF: "GF",
	PYF: "PF",
	ATF: "TF",
	GAB: "GA",
	GMB: "GM",
	GEO: "GE",
	DEU: "DE",
	GHA: "GH",
	GIB: "GI",
	GRC: "GR",
	GRL: "GL",
	GRD: "GD",
	GLP: "GP",
	GUM: "GU",
	GTM: "GT",
	GGY: "GG",
	GIN: "GN",
	GNB: "GW",
	GUY: "GY",
	HTI: "HT",
	HMD: "HM",
	VAT: "VA",
	HND: "HN",
	HKG: "HK",
	HUN: "HU",
	ISL: "IS",
	IND: "IN",
	IDN: "ID",
	IRN: "IR",
	IRQ: "IQ",
	IRL: "IE",
	IMN: "IM",
	ISR: "IL",
	ITA: "IT",
	JAM: "JM",
	JPN: "JP",
	JEY: "JE",
	JOR: "JO",
	KAZ: "KZ",
	KEN: "KE",
	KIR: "KI",
	PRK: "KP",
	KOR: "KR",
	KWT: "KW",
	KGZ: "KG",
	LAO: "LA",
	LVA: "LV",
	LBN: "LB",
	LSO: "LS",
	LBR: "LR",
	LBY: "LY",
	LIE: "LI",
	LTU: "LT",
	LUX: "LU",
	MAC: "MO",
	MKD: "MK",
	MDG: "MG",
	MWI: "MW",
	MYS: "MY",
	MDV: "MV",
	MLI: "ML",
	MLT: "MT",
	MHL: "MH",
	MTQ: "MQ",
	MRT: "MR",
	MUS: "MU",
	MYT: "YT",
	MEX: "MX",
	FSM: "FM",
	MDA: "MD",
	MCO: "MC",
	MNG: "MN",
	MNE: "ME",
	MSR: "MS",
	MAR: "MA",
	MOZ: "MZ",
	MMR: "MM",
	NAM: "NA",
	NRU: "NR",
	NPL: "NP",
	NLD: "NL",
	NCL: "NC",
	NZL: "NZ",
	NIC: "NI",
	NER: "NE",
	NGA: "NG",
	NIU: "NU",
	NFK: "NF",
	MNP: "MP",
	NOR: "NO",
	OMN: "OM",
	PAK: "PK",
	PLW: "PW",
	PSE: "PS",
	PAN: "PA",
	PNG: "PG",
	PRY: "PY",
	PER: "PE",
	PHL: "PH",
	PCN: "PN",
	POL: "PL",
	PRT: "PT",
	PRI: "PR",
	QAT: "QA",
	REU: "RE",
	ROU: "RO",
	RUS: "RU",
	RWA: "RW",
	BLM: "BL",
	SHN: "SH",
	KNA: "KN",
	LCA: "LC",
	MAF: "MF",
	SPM: "PM",
	VCT: "VC",
	WSM: "WS",
	SMR: "SM",
	STP: "ST",
	SAU: "SA",
	SEN: "SN",
	SRB: "RS",
	SYC: "SC",
	SLE: "SL",
	SGP: "SG",
	SXM: "SX",
	SVK: "SK",
	SVN: "SI",
	SLB: "SB",
	SOM: "SO",
	ZAF: "ZA",
	SGS: "GS",
	SSD: "SS",
	ESP: "ES",
	LKA: "LK",
	SDN: "SD",
	SUR: "SR",
	SJM: "SJ",
	SWE: "SE",
	CHE: "CH",
	SYR: "SY",
	TWN: "TW",
	TJK: "TJ",
	TZA: "TZ",
	THA: "TH",
	TLS: "TL",
	TGO: "TG",
	TKL: "TK",
	TON: "TO",
	TTO: "TT",
	TUN: "TN",
	TUR: "TR",
	TKM: "TM",
	TCA: "TC",
	TUV: "TV",
	UGA: "UG",
	UKR: "UA",
	ARE: "AE",
	GBR: "GB",
	USA: "US",
	UMI: "UM",
	URY: "UY",
	UZB: "UZ",
	VUT: "VU",
	VEN: "VE",
	VNM: "VN",
	VGB: "VG",
	VIR: "VI",
	WLF: "WF",
	ESH: "EH",
	YEM: "YE",
	ZMB: "ZM",
	ZWE: "ZW",
	ALA: "AX",
	XXK: "XK",
};

export type Entry = {
	label: string;
	children?: Entry[];
};

export const COUNTRY_HIERARCHY: Entry = {
	label: "World",
	children: [
		{
			label: "Africa",
			children: [
				{
					label: "Eastern Africa",
					children: [
						{ label: "BI" }, // Burundi
						{ label: "KM" }, // Comoros
						{ label: "DJ" }, // Djibouti
						{ label: "ER" }, // Eritrea
						{ label: "ET" }, // Ethiopia
						{ label: "IO" }, // British Indian Ocean Territory (Added)
						{ label: "KE" }, // Kenya
						{ label: "MG" }, // Madagascar
						{ label: "MW" }, // Malawi
						{ label: "MU" }, // Mauritius
						{ label: "YT" }, // Mayotte
						{ label: "MZ" }, // Mozambique
						{ label: "RE" }, // Reunion
						{ label: "RW" }, // Rwanda
						{ label: "SC" }, // Seychelles
						{ label: "SO" }, // Somalia
						{ label: "SS" }, // South Sudan
						{ label: "TZ" }, // Tanzania
						{ label: "UG" }, // Uganda
						{ label: "ZM" }, // Zambia
						{ label: "ZW" }, // Zimbabwe
					],
				},
				{
					label: "Middle Africa",
					children: [
						{ label: "AO" }, // Angola
						{ label: "CM" }, // Cameroon
						{ label: "CF" }, // Central African Republic
						{ label: "TD" }, // Chad
						{ label: "CG" }, // Congo
						{ label: "CD" }, // Congo, Democratic Republic of the
						{ label: "GQ" }, // Equatorial Guinea
						{ label: "GA" }, // Gabon
						{ label: "ST" }, // Sao Tome and Principe
					],
				},
				{
					label: "Northern Africa",
					children: [
						{ label: "DZ" }, // Algeria
						{ label: "EG" }, // Egypt
						{ label: "LY" }, // Libyan Arab Jamahiriya
						{ label: "MA" }, // Morocco
						{ label: "SD" }, // Sudan
						{ label: "TN" }, // Tunisia
						{ label: "EH" }, // Western Sahara
					],
				},
				{
					label: "Southern Africa",
					children: [
						{ label: "BW" }, // Botswana
						{ label: "SZ" }, // Eswatini / Swaziland
						{ label: "LS" }, // Lesotho
						{ label: "NA" }, // Namibia
						{ label: "ZA" }, // South Africa
					],
				},
				{
					label: "Western Africa",
					children: [
						{ label: "BJ" }, // Benin
						{ label: "BF" }, // Burkina Faso
						{ label: "CV" }, // Cabo Verde
						{ label: "CI" }, // Cote d'Ivoire / Ivory Coast
						{ label: "GM" }, // Gambia
						{ label: "GH" }, // Ghana
						{ label: "GN" }, // Guinea
						{ label: "GW" }, // Guinea-Bissau
						{ label: "LR" }, // Liberia
						{ label: "ML" }, // Mali
						{ label: "MR" }, // Mauritania
						{ label: "NE" }, // Niger
						{ label: "NG" }, // Nigeria
						{ label: "SH" }, // Saint Helena
						{ label: "SN" }, // Senegal
						{ label: "SL" }, // Sierra Leone
						{ label: "TG" }, // Togo
					],
				},
			],
		},
		{
			label: "Americas",
			children: [
				{
					label: "Caribbean",
					children: [
						{ label: "AI" }, // Anguilla
						{ label: "AG" }, // Antigua and Barbuda
						{ label: "AW" }, // Aruba
						{ label: "BS" }, // Bahamas
						{ label: "BB" }, // Barbados
						{ label: "BQ" }, // Bonaire
						{ label: "VG" }, // British Virgin Islands
						{ label: "KY" }, // Cayman Islands
						{ label: "CU" }, // Cuba
						{ label: "CW" }, // Curacao
						{ label: "DM" }, // Dominica
						{ label: "DO" }, // Dominican Republic
						{ label: "GD" }, // Grenada
						{ label: "GP" }, // Guadeloupe
						{ label: "HT" }, // Haiti
						{ label: "JM" }, // Jamaica
						{ label: "MQ" }, // Martinique
						{ label: "MS" }, // Montserrat
						{ label: "PR" }, // Puerto Rico
						{ label: "BL" }, // Saint Barthelemy
						{ label: "KN" }, // Saint Kitts and Nevis
						{ label: "LC" }, // Saint Lucia
						{ label: "MF" }, // Saint Martin
						{ label: "PM" }, // Saint Pierre and Miquelon
						{ label: "VC" }, // Saint Vincent and the Grenadines
						{ label: "SX" }, // Sint Maarten
						{ label: "TT" }, // Trinidad and Tobago
						{ label: "TC" }, // Turks and Caicos Islands
						{ label: "VI" }, // U.S. Virgin Islands
					],
				},
				{
					label: "Central America",
					children: [
						{ label: "BZ" }, // Belize
						{ label: "CR" }, // Costa Rica
						{ label: "SV" }, // El Salvador
						{ label: "GT" }, // Guatemala
						{ label: "HN" }, // Honduras
						{ label: "MX" }, // Mexico
						{ label: "NI" }, // Nicaragua
						{ label: "PA" }, // Panama
					],
				},
				{
					label: "North America",
					children: [
						{ label: "BM" }, // Bermuda
						{ label: "CA" }, // Canada
						{ label: "GL" }, // Greenland
						{ label: "US" }, // United States
						{ label: "UM" }, // United States Minor Outlying Islands
					],
				},
				{
					label: "South America",
					children: [
						{ label: "AR" }, // Argentina
						{ label: "BO" }, // Bolivia
						{ label: "BR" }, // Brazil
						{ label: "CL" }, // Chile
						{ label: "CO" }, // Colombia
						{ label: "EC" }, // Ecuador
						{ label: "FK" }, // Falkland Islands (Malvinas)
						{ label: "GF" }, // French Guiana
						{ label: "GY" }, // Guyana
						{ label: "PY" }, // Paraguay
						{ label: "PE" }, // Peru
						{ label: "SR" }, // Suriname
						{ label: "UY" }, // Uruguay
						{ label: "VE" }, // Venezuela
					],
				},
			],
		},
		{
			label: "Asia",
			children: [
				{
					label: "Central Asia",
					children: [
						{ label: "KZ" }, // Kazakhstan
						{ label: "KG" }, // Kyrgyzstan
						{ label: "TJ" }, // Tajikistan
						{ label: "TM" }, // Turkmenistan
						{ label: "UZ" }, // Uzbekistan
					],
				},
				{
					label: "Eastern Asia",
					children: [
						{ label: "CN" }, // China
						{ label: "HK" }, // Hong Kong
						{ label: "JP" }, // Japan
						{ label: "KP" }, // Korea, Democratic People's Republic of
						{ label: "KR" }, // Korea, Republic of
						{ label: "MO" }, // Macao
						{ label: "MN" }, // Mongolia
						{ label: "TW" }, // Taiwan
					],
				},
				{
					label: "South-Eastern Asia",
					children: [
						{ label: "BN" }, // Brunei Darussalam
						{ label: "KH" }, // Cambodia
						{ label: "ID" }, // Indonesia
						{ label: "LA" }, // Lao People's Democratic Republic
						{ label: "MY" }, // Malaysia
						{ label: "MM" }, // Myanmar
						{ label: "PH" }, // Philippines
						{ label: "SG" }, // Singapore
						{ label: "TH" }, // Thailand
						{ label: "TL" }, // Timor-Leste
						{ label: "VN" }, // Viet Nam
					],
				},
				{
					label: "Southern Asia",
					children: [
						{ label: "AF" }, // Afghanistan
						{ label: "BD" }, // Bangladesh
						{ label: "BT" }, // Bhutan
						{ label: "IN" }, // India
						{ label: "IR" }, // Iran, Islamic Republic of
						{ label: "MV" }, // Maldives
						{ label: "NP" }, // Nepal
						{ label: "PK" }, // Pakistan
						{ label: "LK" }, // Sri Lanka
					],
				},
				{
					label: "Western Asia",
					children: [
						{ label: "AM" }, // Armenia
						{ label: "AZ" }, // Azerbaijan
						{ label: "BH" }, // Bahrain
						{ label: "CY" }, // Cyprus
						{ label: "GE" }, // Georgia
						{ label: "IQ" }, // Iraq
						{ label: "IL" }, // Israel
						{ label: "JO" }, // Jordan
						{ label: "KW" }, // Kuwait
						{ label: "LB" }, // Lebanon
						{ label: "OM" }, // Oman
						{ label: "PS" }, // Palestine
						{ label: "QA" }, // Qatar
						{ label: "SA" }, // Saudi Arabia
						{ label: "SY" }, // Syrian Arab Republic
						{ label: "TR" }, // Turkey
						{ label: "AE" }, // United Arab Emirates
						{ label: "YE" }, // Yemen
					],
				},
			],
		},
		{
			label: "Europe",
			children: [
				{
					label: "Eastern Europe",
					children: [
						{ label: "BY" }, // Belarus
						{ label: "BG" }, // Bulgaria
						{ label: "CZ" }, // Czech Republic
						{ label: "HU" }, // Hungary
						{ label: "MD" }, // Moldova, Republic of
						{ label: "PL" }, // Poland
						{ label: "RO" }, // Romania
						{ label: "RU" }, // Russian Federation
						{ label: "SK" }, // Slovakia
						{ label: "UA" }, // Ukraine
					],
				},
				{
					label: "Northern Europe",
					children: [
						{ label: "AX" }, // Åland Islands
						{ label: "DK" }, // Denmark
						{ label: "EE" }, // Estonia
						{ label: "FO" }, // Faroe Islands
						{ label: "FI" }, // Finland
						{ label: "GG" }, // Guernsey
						{ label: "IS" }, // Iceland
						{ label: "IE" }, // Ireland
						{ label: "IM" }, // Isle of Man
						{ label: "JE" }, // Jersey
						{ label: "LV" }, // Latvia
						{ label: "LT" }, // Lithuania
						{ label: "NO" }, // Norway
						{ label: "SJ" }, // Svalbard and Jan Mayen
						{ label: "SE" }, // Sweden
						{ label: "GB" }, // United Kingdom
					],
				},
				{
					label: "Southern Europe",
					children: [
						{ label: "AL" }, // Albania
						{ label: "AD" }, // Andorra
						{ label: "BA" }, // Bosnia and Herzegovina
						{ label: "HR" }, // Croatia
						{ label: "GI" }, // Gibraltar
						{ label: "GR" }, // Greece
						{ label: "VA" }, // Holy See (Vatican City State)
						{ label: "IT" }, // Italy
						{ label: "MT" }, // Malta
						{ label: "ME" }, // Montenegro
						{ label: "PT" }, // Portugal
						{ label: "SM" }, // San Marino
						{ label: "RS" }, // Serbia
						{ label: "SI" }, // Slovenia
						{ label: "ES" }, // Spain
						{ label: "MK" }, // Macedonia, The Republic of North
						{ label: "XK" }, // Kosovo
					],
				},
				{
					label: "Western Europe",
					children: [
						{ label: "AT" }, // Austria
						{ label: "BE" }, // Belgium
						{ label: "FR" }, // France
						{ label: "DE" }, // Germany
						{ label: "LI" }, // Liechtenstein
						{ label: "LU" }, // Luxembourg
						{ label: "MC" }, // Monaco
						{ label: "NL" }, // Netherlands
						{ label: "CH" }, // Switzerland
					],
				},
			],
		},
		{
			label: "Oceania",
			children: [
				{
					label: "Australia and New Zealand",
					children: [
						{ label: "AU" }, // Australia
						{ label: "CX" }, // Christmas Island
						{ label: "CC" }, // Cocos (Keeling) Islands
						{ label: "HM" }, // Heard Island and Mcdonald Islands
						{ label: "NF" }, // Norfolk Island
						{ label: "NZ" }, // New Zealand
					],
				},
				{
					label: "Melanesia",
					children: [
						{ label: "FJ" }, // Fiji
						{ label: "NC" }, // New Caledonia
						{ label: "PG" }, // Papua New Guinea
						{ label: "SB" }, // Solomon Islands
						{ label: "VU" }, // Vanuatu
					],
				},
				{
					label: "Micronesia",
					children: [
						{ label: "GU" }, // Guam
						{ label: "KI" }, // Kiribati
						{ label: "MH" }, // Marshall Islands
						{ label: "FM" }, // Micronesia, Federated States of
						{ label: "NR" }, // Naoero
						{ label: "MP" }, // Northern Mariana Islands
						{ label: "PW" }, // Palau
					],
				},
				{
					label: "Polynesia",
					children: [
						{ label: "AS" }, // American Samoa
						{ label: "CK" }, // Cook Islands
						{ label: "PF" }, // French Polynesia
						{ label: "NU" }, // Niue
						{ label: "PN" }, // Pitcairn
						{ label: "WS" }, // Samoa
						{ label: "TK" }, // Tokelau
						{ label: "TO" }, // Tonga
						{ label: "TV" }, // Tuvalu
						{ label: "WF" }, // Wallis and Futuna
					],
				},
			],
		},
		{
			label: "Antarctica",
			children: [
				{
					label: "Antarctica", // Note: This intermediate label might be redundant
					children: [
						{ label: "AQ" }, // Antarctica
						{ label: "BV" }, // Bouvet Island
						{ label: "TF" }, // French Southern Territories
						{ label: "GS" }, // South Georgia and the South Sandwich Islands
					],
				},
			],
		},
	],
};

export const COUNTRY_PARAMS: Record<string, string> = (() => {
	const result: Record<string, string> = {};

	function traverse(node: Entry, path: string[] = []) {
		if (!node.children) {
			result[node.label] = [...path, node.label].join(" > ");
			return;
		}

		const currentPath = node.label === "World" ? [] : [...path, node.label];

		for (const child of node.children) {
			traverse(child, currentPath);
		}
	}

	traverse(COUNTRY_HIERARCHY);
	return result;
})();

export const CSL_SKIP_WORDS = [
	"about",
	"above",
	"across",
	"afore",
	"after",
	"against",
	"al",
	"along",
	"alongside",
	"amid",
	"amidst",
	"among",
	"amongst",
	"anenst",
	"apropos",
	"apud",
	"around",
	"as",
	"aside",
	"astride",
	"at",
	"athwart",
	"atop",
	"barring",
	"before",
	"behind",
	"below",
	"beneath",
	"beside",
	"besides",
	"between",
	"beyond",
	"but",
	"by",
	"circa",
	"despite",
	"down",
	"during",
	"et",
	"except",
	"for",
	"forenenst",
	"from",
	"given",
	"in",
	"inside",
	"into",
	"lest",
	"like",
	"modulo",
	"near",
	"next",
	"notwithstanding",
	"of",
	"off",
	"on",
	"onto",
	"out",
	"over",
	"per",
	"plus",
	"pro",
	"qua",
	"sans",
	"since",
	"than",
	"through",
	" thru",
	"throughout",
	"thruout",
	"till",
	"to",
	"toward",
	"towards",
	"under",
	"underneath",
	"until",
	"unto",
	"up",
	"upon",
	"versus",
	"vs.",
	"v.",
	"vs",
	"v",
	"via",
	"vis-à-vis",
	"with",
	"within",
	"without",
	"according to",
	"ahead of",
	"apart from",
	"as for",
	"as of",
	"as per",
	"as regards",
	"aside from",
	"back to",
	"because of",
	"close to",
	"due to",
	"except for",
	"far from",
	"inside of",
	"instead of",
	"near to",
	"next to",
	"on to",
	"out from",
	"out of",
	"outside of",
	"prior to",
	"pursuant to",
	"rather than",
	"regardless of",
	"such as",
	"that of",
	"up to",
	"where as",
	"or",
	"yet",
	"so",
	"for",
	"and",
	"nor",
	"a",
	"an",
	"the",
	"de",
	"d'",
	"von",
	"van",
	"c",
	"ca",
];

export const SITEMAP_SIZE = 10000;

/**
 * Acceptable referrer paths that users can navigate back to.
 * If a referrer doesn't start with one of these, it defaults to /lib.
 */
export const ACCEPTABLE_REFERRERS = ["/lib", "/profile"] as const;

export const DEFAULT_REFERRER = "/lib";

/**
 * Validates and sanitizes a referrer path.
 * Returns the referrer if it starts with an acceptable path, otherwise returns the default.
 */
export function getSafeReferrer(referrer: string | null | undefined): string {
	if (!referrer) return DEFAULT_REFERRER;

	const isAcceptable = ACCEPTABLE_REFERRERS.some((acceptable) =>
		referrer.startsWith(acceptable),
	);

	return isAcceptable ? referrer : DEFAULT_REFERRER;
}

/**
 * Where a record's link says it was opened from: the profile it is on, or the one it carries. Every other page leads
 * back to the default list, so naming it would only give each record a second address for search engines to find.
 */
export function recordReferrer(path: string, carried: string | null | undefined): string | null {
	return [carried, path].find((from) => from?.startsWith("/profile")) ?? null;
}

export const COUNTRY_COLORS: Record<string, string> = {
	AD: "#d82626",
	AE: "#d82a26",
	AF: "#d82e26",
	AG: "#d83326",
	AI: "#d83726",
	AL: "#d83b26",
	AM: "#d83f26",
	AO: "#d84826",
	AQ: "#d84c26",
	AR: "#d85026",
	AS: "#d85526",
	AT: "#d85926",
	AU: "#d85d26",
	AW: "#d86126",
	AX: "#d86626",
	AZ: "#d86a26",
	BA: "#d86e26",
	BB: "#d87226",
	BD: "#d87726",
	BE: "#d87b26",
	BF: "#d87f26",
	BG: "#d88326",
	BH: "#d88826",
	BI: "#d88c26",
	BJ: "#d89026",
	BL: "#d89426",
	BM: "#d89926",
	BN: "#d89d26",
	BO: "#d8a126",
	BQ: "#d8a526",
	BR: "#d8aa26",
	BS: "#d8ae26",
	BT: "#d8b226",
	BV: "#d8b626",
	BW: "#d8bb26",
	BY: "#d8bf26",
	BZ: "#d8c326",
	CA: "#d8c726",
	CC: "#d8cc26",
	CD: "#d8d026",
	CF: "#d8d426",
	CG: "#d8d826",
	CH: "#d4d826",
	CI: "#d0d826",
	CK: "#ccd826",
	CL: "#c7d826",
	CM: "#c3d826",
	CN: "#bfd826",
	CO: "#bbd826",
	CR: "#b6d826",
	CU: "#b2d826",
	CV: "#aed826",
	CW: "#aad826",
	CX: "#a5d826",
	CY: "#a1d826",
	CZ: "#9dd826",
	DE: "#99d826",
	DJ: "#94d826",
	DK: "#90d826",
	DM: "#8cd826",
	DO: "#88d826",
	DZ: "#83d826",
	EC: "#7fd826",
	EE: "#7bd826",
	EG: "#77d826",
	EH: "#72d826",
	ER: "#6ed826",
	ES: "#6ad826",
	ET: "#66d826",
	FI: "#61d826",
	FJ: "#5dd826",
	FK: "#59d826",
	FM: "#55d826",
	FO: "#50d826",
	FR: "#4cd826",
	GA: "#48d826",
	GB: "#44d826",
	GD: "#3fd826",
	GE: "#3bd826",
	GF: "#37d826",
	GG: "#33d826",
	GH: "#2ed826",
	GI: "#2ad826",
	GL: "#26d826",
	GM: "#26d82a",
	GN: "#26d82e",
	GP: "#26d833",
	GQ: "#26d837",
	GR: "#26d83b",
	GS: "#26d83f",
	GT: "#26d844",
	GU: "#26d848",
	GW: "#26d84c",
	GY: "#26d850",
	HK: "#26d855",
	HM: "#26d859",
	HN: "#26d85d",
	HR: "#26d861",
	HT: "#26d866",
	HU: "#26d86a",
	ID: "#26d86e",
	IE: "#26d872",
	IL: "#26d877",
	IM: "#26d87b",
	IN: "#26d87f",
	IO: "#26d883",
	IQ: "#26d888",
	IR: "#26d88c",
	IS: "#26d890",
	IT: "#26d894",
	JE: "#26d899",
	JM: "#26d89d",
	JO: "#26d8a1",
	JP: "#26d8a5",
	KE: "#26d8aa",
	KG: "#26d8ae",
	KH: "#26d8b2",
	KI: "#26d8b6",
	KM: "#26d8bb",
	KN: "#26d8bf",
	KP: "#26d8c3",
	KR: "#26d8c7",
	KW: "#26d8cc",
	KY: "#26d8d0",
	KZ: "#26d8d4",
	LA: "#26d8d8",
	LB: "#26d4d8",
	LC: "#26d0d8",
	LI: "#26ccd8",
	LK: "#26c7d8",
	LR: "#26c3d8",
	LS: "#26bfd8",
	LT: "#26bbd8",
	LU: "#26b6d8",
	LV: "#26b2d8",
	LY: "#26aed8",
	MA: "#26aad8",
	MC: "#26a5d8",
	MD: "#26a1d8",
	ME: "#269dd8",
	MF: "#2699d8",
	MG: "#2694d8",
	MH: "#2690d8",
	MK: "#268cd8",
	ML: "#2688d8",
	MM: "#2683d8",
	MN: "#267fd8",
	MO: "#267bd8",
	MP: "#2677d8",
	MQ: "#2672d8",
	MR: "#266ed8",
	MS: "#266ad8",
	MT: "#2666d8",
	MU: "#2661d8",
	MV: "#265dd8",
	MW: "#2659d8",
	MX: "#2655d8",
	MY: "#2650d8",
	MZ: "#264cd8",
	NA: "#2648d8",
	NC: "#2644d8",
	NE: "#263fd8",
	NF: "#263bd8",
	NG: "#2637d8",
	NI: "#2633d8",
	NL: "#262ed8",
	NO: "#262ad8",
	NP: "#2a26d8",
	NR: "#2e26d8",
	NU: "#3326d8",
	NZ: "#3726d8",
	OM: "#3b26d8",
	PA: "#3f26d8",
	PE: "#4426d8",
	PF: "#4826d8",
	PG: "#4c26d8",
	PH: "#5026d8",
	PK: "#5526d8",
	PL: "#5926d8",
	PM: "#5d26d8",
	PN: "#6126d8",
	PR: "#6626d8",
	PS: "#6a26d8",
	PT: "#6e26d8",
	PW: "#7226d8",
	PY: "#7726d8",
	QA: "#7b26d8",
	RE: "#7f26d8",
	RO: "#8326d8",
	RS: "#8826d8",
	RU: "#8c26d8",
	RW: "#9026d8",
	SA: "#9426d8",
	SB: "#9926d8",
	SC: "#9d26d8",
	SD: "#a126d8",
	SE: "#a526d8",
	SG: "#aa26d8",
	SH: "#ae26d8",
	SI: "#b226d8",
	SJ: "#b626d8",
	SK: "#bb26d8",
	SL: "#bf26d8",
	SM: "#c326d8",
	SN: "#c726d8",
	SO: "#cc26d8",
	SR: "#d026d8",
	SS: "#d426d8",
	ST: "#d826d8",
	SV: "#d826d4",
	SX: "#d826d0",
	SY: "#d826cc",
	SZ: "#d826c8",
	TC: "#d826c4",
	TD: "#d826bf",
	TF: "#d826bb",
	TG: "#d826b7",
	TH: "#d826b3",
	TJ: "#d826ae",
	TK: "#d826aa",
	TL: "#d826a6",
	TM: "#d826a1",
	TN: "#d8269d",
	TO: "#d82699",
	TR: "#d82695",
	TT: "#d82690",
	TV: "#d8268c",
	TW: "#d82688",
	TZ: "#d82684",
	UA: "#d8267f",
	UG: "#d8267b",
	UM: "#d82677",
	US: "#d82673",
	UY: "#d8266e",
	UZ: "#d8266a",
	VA: "#d82666",
	VC: "#d82661",
	VE: "#d8265d",
	VG: "#d82659",
	VI: "#d82655",
	VN: "#d82650",
	VU: "#d8264c",
	WF: "#d82648",
	WS: "#d82644",
	XK: "#d8263f",
	YE: "#d8263b",
	YT: "#d82637",
	ZA: "#d82633",
	ZM: "#d8262e",
	ZW: "#d8262a",
	UNKNOWN: "#9ca3af", // Gray for unknown/global
};
