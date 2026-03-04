import { useMemo, useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { BsBuilding, BsSearch } from "react-icons/bs";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/heroui/Table";
import { Input } from "@/components/heroui/Input";
import { Select } from "@/components/heroui/Select";
import { SelectItem } from "@/components/heroui/SelectItem";
import { Switch } from "@/components/heroui/Switch";
import { Pagination } from "@/components/heroui/Pagination";
import { Card } from "@/components/heroui/Card";
import { SectionCard } from "./SectionCard";
import { CountryFlag } from "./CountryFlag";
import { InstitutionStats, InstitutionYearStats, AuthorCountryStats } from "./types";

type InstitutionsTableProps = {
	institutions: InstitutionStats[];
	institutionsByYear: InstitutionYearStats[];
	availableYears: string[];
	authorCountries: AuthorCountryStats[];
};

export function InstitutionsTable({ 
	institutions, 
	institutionsByYear, 
	availableYears, 
	authorCountries 
}: InstitutionsTableProps) {
	const t = useTranslations("ui");
	const [institutionsPage, setInstitutionsPage] = useState(1);
	const [institutionsSearch, setInstitutionsSearch] = useState("");
	const [showTopCountryOnly, setShowTopCountryOnly] = useState(false);
	const [selectedYear, setSelectedYear] = useState<string>("all");
	const [institutionsSortDescriptor, setInstitutionsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "itemCount",
		direction: "descending"
	});
	const rowsPerPage = 10;

	// Find the country with the most items
	const topCountry = useMemo(() => {
		if (authorCountries.length === 0) return null;
		return authorCountries[0]; // Already sorted by item count desc
	}, [authorCountries]);

	// Aggregate institutions by year or use all-time data
	const aggregatedInstitutions = useMemo(() => {
		if (selectedYear === "all") {
			return institutions;
		}

		// Aggregate data for the selected year
		const yearData = institutionsByYear.filter(
			(inst) => inst.year === selectedYear
		);

		// Group by institution and sum up the data
		const institutionMap = new Map<string, InstitutionStats>();

		yearData.forEach((inst) => {
			const key = `${inst.institution}-${inst.countryCode}`;
			if (institutionMap.has(key)) {
				const existing = institutionMap.get(key)!;
				existing.itemCount += inst.itemCount;
				existing.totalCitations += inst.totalCitations;
				// Recalculate average citations per item
				existing.avgCitationsPerItem =
					existing.totalCitations / existing.itemCount;
				// For H-Index, we'd need to recalculate with all citation counts, but for simplicity, take the max
				existing.hIndex = Math.max(existing.hIndex, inst.hIndex);
			} else {
				institutionMap.set(key, {
					institution: inst.institution,
					countryCode: inst.countryCode,
					itemCount: inst.itemCount,
					totalCitations: inst.totalCitations,
					avgCitationsPerItem: inst.avgCitationsPerItem,
					hIndex: inst.hIndex,
				});
			}
		});

		return Array.from(institutionMap.values()).sort(
			(a, b) => b.itemCount - a.itemCount
		);
	}, [institutions, institutionsByYear, selectedYear]);

	const filteredInstitutions = useMemo(() => {
		let filtered = aggregatedInstitutions;

		// Filter by top country institutions if toggle is on
		if (showTopCountryOnly && topCountry) {
			filtered = filtered.filter(
				(institution) =>
					institution.countryCode === topCountry.countryCode
			);
		}

		// Filter by search term
		if (institutionsSearch.trim()) {
			filtered = filtered.filter((institution) =>
				institution.institution
					.toLowerCase()
					.includes(institutionsSearch.toLowerCase())
			);
		}

		// Apply sorting
		const sorted = [...filtered].sort((a, b) => {
			let aValue: any = a[institutionsSortDescriptor.column as keyof InstitutionStats];
			let bValue: any = b[institutionsSortDescriptor.column as keyof InstitutionStats];

			// Handle string sorting
			if (typeof aValue === "string") {
				aValue = aValue.toLowerCase();
				bValue = bValue.toLowerCase();
			}

			let comparison = 0;
			if (aValue < bValue) {
				comparison = -1;
			} else if (aValue > bValue) {
				comparison = 1;
			}

			return institutionsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});

		return sorted;
	}, [
		aggregatedInstitutions,
		institutionsSearch,
		showTopCountryOnly,
		topCountry,
		institutionsSortDescriptor,
	]);

	const paginatedInstitutions = useMemo(() => {
		const start = (institutionsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return filteredInstitutions.slice(start, end);
	}, [filteredInstitutions, institutionsPage]);

	const institutionsPages = Math.ceil(
		filteredInstitutions.length / rowsPerPage
	);

	// Reset institutions page when search or filters change
	useEffect(() => {
		setInstitutionsPage(1);
	}, [institutionsSearch, showTopCountryOnly, selectedYear]);

	return (
		<SectionCard title={t("allInstitutions")} icon={BsBuilding}>
			<div className="space-y-4">
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					<Input
						label={t("searchInstitutions")}
						value={institutionsSearch}
						onChange={(e) =>
							setInstitutionsSearch(e.target.value)
						}
						placeholder={t("searchByInstitutionName")}
						startContent={
							<BsSearch className="text-black/40 dark:text-white/40" />
						}
					/>
					<Select
						label={t("filterByYear")}
						placeholder={t("selectYear")}
						placement="left"
						selectedKeys={[selectedYear]}
						onSelectionChange={(keys) => {
							const selected = Array.from(
								keys
							)[0] as string;
							setSelectedYear(selected || "all");
						}}
						classNames={{
							base: "flex-1 max-w-full",
							trigger: "h-full",
						}}
						items={[
							{ key: "all", name: t("allYears") },
							...availableYears.map((year) => ({
								key: year,
								name: year,
							})),
						]}
					>
						{(item: any) => (
							<SelectItem key={item.key}>
								{item.name}
							</SelectItem>
						)}
					</Select>
				</div>
				<Card color="card">
					{topCountry && (
						<div className="flex items-center gap-2 mb-2">
							<CountryFlag countryCode={topCountry.countryCode} className="w-5 h-3" />
							<span className="text-sm font-medium text-black dark:text-white">
								{topCountry.countryName || topCountry.countryCode || t("unknownCountry")} (
								{topCountry.itemCount.toLocaleString()}{" "}
								{t("itemsLowercase")})
							</span>
						</div>
					)}
					<Switch
						isSelected={showTopCountryOnly}
						onValueChange={setShowTopCountryOnly}
						isDisabled={!topCountry}
					>
						<span className="text-sm text-black dark:text-white">
							{t("showOnly")}{" "}
							{topCountry?.countryName || t("topCountry")}{" "}
						</span>
					</Switch>
				</Card>
				<Table
					color="statistics"
					aria-label={t("institutionsTableAriaLabel")}
					sortDescriptor={institutionsSortDescriptor}
					onSortChange={(descriptor: any) => setInstitutionsSortDescriptor(descriptor)}
				>
					<TableHeader>
						<TableColumn key="institution" allowsSorting>
							{t("institutionColumn")}
						</TableColumn>
						<TableColumn key="countryCode" allowsSorting>{t("countryColumn")}</TableColumn>
						<TableColumn key="itemCount" allowsSorting>{t("itemsColumn")}</TableColumn>
						<TableColumn key="totalCitations" allowsSorting>
							{t("citationsColumn")}
						</TableColumn>
						<TableColumn key="avgCitationsPerItem" allowsSorting>
							{t("avgPerItemColumn")}
						</TableColumn>
						<TableColumn key="hIndex" allowsSorting>H-Index</TableColumn>
					</TableHeader>
					<TableBody>
						{paginatedInstitutions.map(
							(institution, index) => (
								<TableRow key={index}>
									<TableCell className="font-medium">
										{institution.institution}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<CountryFlag countryCode={institution.countryCode} />
											<span className="text-sm font-medium">
												{institution.countryCode || t("unknown")}
											</span>
										</div>
									</TableCell>
									<TableCell>
										<span className="font-bold text-accent">
											{institution.itemCount.toLocaleString()}
										</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-success">
											{institution.totalCitations.toLocaleString()}
										</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-tertiary">
											{institution.avgCitationsPerItem.toFixed(
												1
											)}
										</span>
									</TableCell>
									<TableCell>
										<span className="font-bold text-purple-600 dark:text-purple-400">
											{institution.hIndex}
										</span>
									</TableCell>
								</TableRow>
							)
						)}
					</TableBody>
				</Table>
				{institutionsPages > 1 && (
					<div className="flex justify-center">
						<Pagination
							total={institutionsPages}
							page={institutionsPage}
							onChange={setInstitutionsPage}
							showControls
							size="sm"
						/>
					</div>
				)}
			</div>
		</SectionCard>
	);
} 