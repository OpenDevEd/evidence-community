export type InstitutionStats = {
	institution: string;
	countryCode: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export type InstitutionYearStats = {
	institution: string;
	countryCode: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export type ItemTypeStats = {
	itemType: string;
	count: number;
	percentage: number;
};

export type YearStats = {
	year: string;
	count: number;
};

export type CitationStats = {
	totalItems: number;
	itemsWithCitations: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	maxCitations: number;
	citationPercentage: number;
	hIndex: number;
};

export type CreatorStats = {
	totalCreators: number;
	uniqueCreators: number;
	avgCreatorsPerItem: number;
	maxCreatorsPerItem: number;
};

export type FieldStats = {
	field: string;
	filledCount: number;
	percentage: number;
};

export type AttachmentStats = {
	totalAttachments: number;
	itemsWithAttachments: number;
	attachmentPercentage: number;
};

export type AuthorCountryStats = {
	countryCode: string;
	countryName: string;
	authorCount: number;
	itemCount: number;
	hIndex: number;
};

export type AuthorStats = {
	authorName: string;
	firstName: string;
	lastName: string;
	displayName: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
	countryCount: number;
	institutionCount: number;
	creatorTypes: string[];
	mostCommonCreatorType: string;
	countries: string[];
	institutions: string[];
	firstPublicationYear: number;
	lastPublicationYear: number;
	yearSpan: number;
	mostRecentYear: number;
};

export type AuthorProductivityStats = {
	totalAuthors: number;
	authorsWithMultipleWorks: number;
	avgItemsPerAuthor: number;
	maxItemsPerAuthor: number;
	productivityDistribution: {
		range: string;
		count: number;
		percentage: number;
	}[];
};

export type AuthorCollaborationStats = {
	soloAuthors: number;
	collaborativeAuthors: number;
	avgCollaboratorsPerAuthor: number;
	maxCollaboratorsPerAuthor: number;
	collaborationRate: number;
};

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

export type TopicStats = {
	topic: string;
	level: number;
	parentTopic?: string;
	fullPath: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
	isLeaf: boolean;
	children: string[];
};

export type TopicOverview = {
	totalTopics: number;
	maxDepth: number;
	topLevelTopics: number;
	avgItemsPerTopic: number;
	topicDistribution: {
		level: number;
		count: number;
		percentage: number;
	}[];
};

export type TopicYearStats = {
	topic: string;
	fullPath: string;
	year: string;
	itemCount: number;
	totalCitations: number;
	avgCitationsPerItem: number;
	hIndex: number;
};

export type CitationYearStats = {
	year: string;
	totalCitations: number;
	itemCount: number;
	avgCitationsPerItem: number;
};

export type ComprehensiveStats = {
	institutions: InstitutionStats[];
	institutionsByYear: InstitutionYearStats[];
	topicsByYear: TopicYearStats[];
	availableYears: string[];
	itemTypes: ItemTypeStats[];
	yearDistribution: YearStats[];
	citationStats: CitationStats;
	creatorStats: CreatorStats;
	fieldCompleteness: FieldStats[];
	attachmentStats: AttachmentStats;
	authorCountries: AuthorCountryStats[];
	collaborationStats: CollaborationStats;
	authorStats: AuthorStats[];
	authorProductivityStats: AuthorProductivityStats;
	authorCollaborationStats: AuthorCollaborationStats;
	topPublishers: { publisher: string; count: number }[];
	topJournals: { journal: string; count: number }[];
	languageDistribution: { language: string; count: number }[];
	recentActivity: { date: string; count: number }[];
	topicStats: TopicStats[];
	topicOverview: TopicOverview;
	citationsByYear: CitationYearStats[];
}; 