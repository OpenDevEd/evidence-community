// Import types for the comprehensive stats type
import type { InstitutionStats, InstitutionYearStats } from "./institution-stats";
import type { ItemTypeStats, YearStats, FieldStats, AttachmentStats, CitationYearStats } from "./basic-stats";
import type { CitationStats, CreatorStats } from "./citation-stats";
import type { AuthorCountryStats, AuthorStats, AuthorProductivityStats, AuthorCollaborationStats } from "./author-stats";
import type { CollaborationStats } from "./collaboration-stats";
import type { TopicStats, TopicOverview, TopicYearStats } from "./topic-stats";

// Export utility functions
export { calculateHIndex } from "./utils";

// Export institution-related types and functions
export type { InstitutionStats, InstitutionYearStats } from "./institution-stats";
export { getInstitutionStats, getInstitutionStatsByYear } from "./institution-stats";

// Export basic statistics types and functions
export type { ItemTypeStats, YearStats, FieldStats, AttachmentStats, CitationYearStats } from "./basic-stats";
export { 
	getTotalItems, 
	getAvailableYears, 
	getItemTypeStats, 
	getYearDistribution, 
	getFieldCompleteness, 
	getAttachmentStats, 
	getPublishersAndJournals, 
	getRecentActivity,
	getCitationsByYear 
} from "./basic-stats";

// Export citation-related types and functions
export type { CitationStats, CreatorStats } from "./citation-stats";
export { getCitationStats, getCreatorStats } from "./citation-stats";

// Export author-related types and functions
export type { 
	AuthorCountryStats, 
	AuthorStats, 
	AuthorProductivityStats, 
	AuthorCollaborationStats 
} from "./author-stats";
export { 
	getAuthorCountries, 
	getAuthorProductivityStats, 
	getAuthorCollaborationStats, 
	getDetailedAuthorStats 
} from "./author-stats";

// Export collaboration types and functions
export type { CollaborationStats } from "./collaboration-stats";
export { getCollaborationStats } from "./collaboration-stats";

// Export topic-related types and functions
export type { TopicStats, TopicOverview, TopicYearStats } from "./topic-stats";
export { getTopicStats, getTopicStatsByYear } from "./topic-stats";

// Comprehensive stats type that combines all statistics
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