"use client";

import { NextUIProvider } from "@nextui-org/react";
import { ThemeProvider } from 'next-themes'
import { useRouter } from "next/navigation";


export default function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  return (
    <ThemeProvider attribute={"class"} defaultTheme="dark" disableTransitionOnChange>
      <NextUIProvider navigate={router.push}>{children}</NextUIProvider>
    </ThemeProvider>
  );
}
