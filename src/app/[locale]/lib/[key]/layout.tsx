import { Suspense } from "react";
import LoadingComponent from "./loadingComponent";

export default async function Layout({ children, params }: { children: React.ReactNode, params: { key: string } }) {
    const { key } = await params;

    return (
        <Suspense fallback={<LoadingComponent itemKey={key} />}>
            {children}
        </Suspense>
    )
}