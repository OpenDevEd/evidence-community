import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { BsJournalText } from "react-icons/bs";
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from "@/components/nextui/Table";
import { Pagination } from "@/components/nextui/Pagination";
import { SectionCard } from "./SectionCard";

type TopJournalsProps = {
	topJournals: { journal: string; count: number }[];
};

export function TopJournals({ topJournals }: TopJournalsProps) {
	const t = useTranslations("ui");
	const [journalsPage, setJournalsPage] = useState(1);
	const [journalsSortDescriptor, setJournalsSortDescriptor] = useState<{ column: string, direction: "ascending" | "descending" }>({
		column: "count",
		direction: "descending"
	});
	const rowsPerPage = 10;

	const sortedJournals = useMemo(() => {
		return [...topJournals].sort((a, b) => {
			let aValue: any = a[journalsSortDescriptor.column as keyof typeof a];
			let bValue: any = b[journalsSortDescriptor.column as keyof typeof b];

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

			return journalsSortDescriptor.direction === "descending" ? -comparison : comparison;
		});
	}, [topJournals, journalsSortDescriptor]);

	const paginatedJournals = useMemo(() => {
		const start = (journalsPage - 1) * rowsPerPage;
		const end = start + rowsPerPage;
		return sortedJournals.slice(start, end);
	}, [sortedJournals, journalsPage]);

	const journalsPages = Math.ceil(sortedJournals.length / rowsPerPage);

	if (topJournals.length === 0) {
		return null;
	}

	return (
		<SectionCard title={t("topJournals")} icon={BsJournalText}>
			<div className="space-y-4">
				<Table
					color="statistics"
					aria-label={t("topJournalsTableAriaLabel")}
					sortDescriptor={journalsSortDescriptor}
					onSortChange={(descriptor: any) => setJournalsSortDescriptor(descriptor)}
				>
					<TableHeader>
						<TableColumn key="journal" allowsSorting>
							{t("journalColumn")}
						</TableColumn>
						<TableColumn key="count" allowsSorting>
							{t("articlesColumn")}
						</TableColumn>
					</TableHeader>
					<TableBody>
						{paginatedJournals.map((journal, index) => (
							<TableRow key={index}>
								<TableCell className="font-medium">
									{journal.journal}
								</TableCell>
								<TableCell>
									<span className="font-bold text-success">
										{journal.count.toLocaleString()}
									</span>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				{journalsPages > 1 && (
					<div className="flex justify-center">
						<Pagination
							total={journalsPages}
							page={journalsPage}
							onChange={setJournalsPage}
							showControls
							size="sm"
						/>
					</div>
				)}
			</div>
		</SectionCard>
	);
} 