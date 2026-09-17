import type { Database } from "@/db";
import { item } from "@/db/schema/tables/item";
import { eq, and, sql } from "drizzle-orm";
import { COUNTRIES } from "@/constants/misc";
import {
	affiliationCountryJoin,
	institutionCountryCode,
} from "./institution-country-sql";

export type CollaborationStats = {
	totalItems: number;
	collaborativeItems: number;
	overallCollaborationRate: number;
	baseCountry: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		collaborativeItems: number;
		collaborationRate: number;
	};
	countryCollaborationRates: {
		countryCode: string;
		countryName: string;
		totalItems: number;
		// All international collaborations (including with base country)
		internationalItems: number;
		internationalRate: number;
		// International collaborations excluding base country
		independentItems: number;
		independentRate: number;
		// Domestic/solo publications (no international collaboration)
		domesticItems: number;
		domesticRate: number;
	}[];
	topCollaborations: {
		country1: string;
		country2: string;
		country1Name: string;
		country2Name: string;
		collaborationCount: number;
	}[];
	collaborationMatrix: {
		[key: string]: {
			[key: string]: number;
		};
	};
};

export async function getCollaborationStats(db: Database, authorCountries: { countryCode: string; countryName: string; authorCount: number; itemCount: number; hIndex: number }[]): Promise<CollaborationStats> {
	// First, get all items with their associated countries
	const itemsWithCountriesResult = await db
		.select({
			itemKey: sql<string>`item_key`,
			countries: sql<string[]>`array_agg(distinct country_code)`
		})
		.from(sql`(
			SELECT DISTINCT
				${item.key} as item_key,
				${institutionCountryCode} as country_code
			FROM ${item},
			LATERAL jsonb_array_elements(${item.creators}) as creator_data,
			LATERAL jsonb_array_elements(creator_data->'institutions') as institution_data
			${affiliationCountryJoin}
			WHERE ${item.deleted} = 0 
			AND (${item.parentItem} IS NULL OR ${item.parentItem} = '')
			AND ${item.creators} IS NOT NULL
			AND jsonb_array_length(${item.creators}) > 0
			AND creator_data ? 'institutions'
			AND jsonb_typeof(creator_data->'institutions') = 'array'
			AND jsonb_array_length(creator_data->'institutions') > 0
			AND ${institutionCountryCode} IS NOT NULL
		) as item_countries`)
		.where(sql`country_code IS NOT NULL AND country_code != ''`)
		.groupBy(sql`item_key`);

	// Identify the base country (top country by items)
	const baseCountry = authorCountries[0];
	const baseCountryCode = baseCountry?.countryCode || '';

	// Calculate overall collaboration metrics
	const totalItemsWithCountries = itemsWithCountriesResult.length;
	const collaborativeItems = itemsWithCountriesResult.filter(item => item.countries.length > 1);
	const collaborativeItemsCount = collaborativeItems.length;
	const overallCollaborationRate = totalItemsWithCountries > 0 ? (collaborativeItemsCount / totalItemsWithCountries) * 100 : 0;

	// Calculate base country collaboration metrics
	const baseCountryItems = itemsWithCountriesResult.filter(item => item.countries.includes(baseCountryCode));
	const baseCountryCollaborativeItems = baseCountryItems.filter(item => item.countries.length > 1);
	const baseCountryCollaborationRate = baseCountryItems.length > 0 ? (baseCountryCollaborativeItems.length / baseCountryItems.length) * 100 : 0;

	// Calculate country collaboration rates - three distinct metrics
	const countryCollaborationRates = authorCountries.slice(0, 21).map(country => { // Top 21 countries including base
		const countryItems = itemsWithCountriesResult.filter(item => item.countries.includes(country.countryCode));
		
		// 1. International: all international collaborations (including with base country)
		const internationalItems = countryItems.filter(item => item.countries.length > 1);
		const internationalRate = countryItems.length > 0 ? (internationalItems.length / countryItems.length) * 100 : 0;
		
		// 2. Independent: international collaborations excluding base country
		const independentItems = countryItems.filter(item => 
			item.countries.length > 1 && !item.countries.includes(baseCountryCode)
		);
		const independentRate = countryItems.length > 0 ? (independentItems.length / countryItems.length) * 100 : 0;
		
		// 3. Domestic: no international collaboration (single country only)
		const domesticItems = countryItems.filter(item => item.countries.length === 1);
		const domesticRate = countryItems.length > 0 ? (domesticItems.length / countryItems.length) * 100 : 0;

		return {
			countryCode: country.countryCode,
			countryName: country.countryName,
			totalItems: countryItems.length,
			internationalItems: internationalItems.length,
			internationalRate: Number(internationalRate.toFixed(2)),
			independentItems: independentItems.length,
			independentRate: Number(independentRate.toFixed(2)),
			domesticItems: domesticItems.length,
			domesticRate: Number(domesticRate.toFixed(2))
		};
	});

	// Calculate top collaborations between countries (including base country collaborations)
	const collaborationPairs = new Map<string, number>();
	collaborativeItems.forEach(item => {
		const countries = item.countries.sort();
		for (let i = 0; i < countries.length; i++) {
			for (let j = i + 1; j < countries.length; j++) {
				const country1 = countries[i];
				const country2 = countries[j];
				
				const pairKey = `${country1}-${country2}`;
				collaborationPairs.set(pairKey, (collaborationPairs.get(pairKey) || 0) + 1);
			}
		}
	});

	const topCollaborations = Array.from(collaborationPairs.entries())
		.map(([pair, count]) => {
			const [country1, country2] = pair.split('-');
			return {
				country1,
				country2,
				country1Name: COUNTRIES[country1 as keyof typeof COUNTRIES] || country1,
				country2Name: COUNTRIES[country2 as keyof typeof COUNTRIES] || country2,
				collaborationCount: count
			};
		})
		.sort((a, b) => b.collaborationCount - a.collaborationCount)
		.slice(0, 15);

	// Create collaboration matrix for network visualization
	const collaborationMatrix: { [key: string]: { [key: string]: number } } = {};
	const topCountries = authorCountries.slice(0, 15).map(c => c.countryCode);
	
	// Initialize matrix
	topCountries.forEach(country1 => {
		collaborationMatrix[country1] = {};
		topCountries.forEach(country2 => {
			collaborationMatrix[country1][country2] = 0;
		});
	});

	// Fill matrix with collaboration counts
	collaborativeItems.forEach(item => {
		const countries = item.countries.filter(c => topCountries.includes(c));
		for (let i = 0; i < countries.length; i++) {
			for (let j = i + 1; j < countries.length; j++) {
				const country1 = countries[i];
				const country2 = countries[j];
				collaborationMatrix[country1][country2]++;
				collaborationMatrix[country2][country1]++;
			}
		}
	});

	const collaborationStats: CollaborationStats = {
		totalItems: totalItemsWithCountries,
		collaborativeItems: collaborativeItemsCount,
		overallCollaborationRate: Number(overallCollaborationRate.toFixed(2)),
		baseCountry: {
			countryCode: baseCountryCode,
			countryName: baseCountry?.countryName || '',
			totalItems: baseCountryItems.length,
			collaborativeItems: baseCountryCollaborativeItems.length,
			collaborationRate: Number(baseCountryCollaborationRate.toFixed(2))
		},
		countryCollaborationRates,
		topCollaborations,
		collaborationMatrix
	};
	
	return collaborationStats;
}
