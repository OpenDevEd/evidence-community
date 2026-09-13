import { Suspense, type ReactNode } from "react";
import PageContainer from "@/components/layout/PageContainer";
import { Spinner } from "@/components/nextui/Spinner";

function PageLoading() {
	return (
		<PageContainer
			className="flex min-h-screen items-center justify-center"
			aria-busy="true"
		>
			<Spinner size="lg" aria-label="Loading page" />
		</PageContainer>
	);
}

export default function PageBoundary({
	children,
	fallback = <PageLoading />,
}: {
	children: ReactNode;
	fallback?: ReactNode;
}) {
	return <Suspense fallback={fallback}>{children}</Suspense>;
}
