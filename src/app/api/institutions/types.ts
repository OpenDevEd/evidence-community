 
export type InstitutionResponse = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export type InstitutionsData = {
	topCountryCode: string;
	totalInstitutions: number;
	institutions: InstitutionResponse[];
};
