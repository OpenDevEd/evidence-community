"use client";
import PageContainer from "@/components/layout/PageContainer";
import { Spinner } from "@heroui/react";
import { motion } from "framer-motion";

export default function StatisticsLoading() {
	return <PageContainer>
        <div className="flex flex-col justify-center items-center h-screen space-y-4">
            <Spinner size="lg" />
            <div className="text-center">
                <h1 className="text-2xl font-bold text-black/80 dark:text-white/80 mb-2">Loading Statistics</h1>
                <h2 className="text-lg text-black/60 dark:text-white/60 mb-4">Preparing your data visualization</h2>
                <motion.p 
                    className="text-sm text-black/40 dark:text-white/40 max-w-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 10, duration: 0.5 }}
                >
                    Please note that the first-time load may take a bit longer as we process and organize your data.
                </motion.p>
            </div>
        </div>
    </PageContainer>
}   