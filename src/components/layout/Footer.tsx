"use client";
import Image from "next/image";
import { links, socialLinks } from "@/constants/links";
import { Button } from "@/components/nextui/Button";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useState } from "react";
import { style } from "@/../tailwind.config";
import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/nextui/Skeleton";
import { Link } from "@/i18n/routing";
import { twMerge } from "tailwind-merge";

const footerInfo = {
  email: "opendeved@gmail.com",
  phone: "+1-123-456-7890",
  address: "123 Creativity Lane, Designville",
};

function FooterFieldColumn({
  title,
  content,
}: {
  title: string;
  content: React.ReactNode;
}) {
  return (
    <div className="flex flex-col w-full xl:w-auto items-center xl:items-start">
      <span className="text-black/80 dark:text-white/80 font-bold text-xl">
        {title}
      </span>
      {content}
    </div>
  );
}

function Logo() {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <Skeleton isLoaded={isLoaded} className="w-[14.5rem] h-[3.375rem] rounded-lg">
      {["dark", "light"].map((themeToMatch) => (
        <Image
          key={themeToMatch}
          onLoad={() => setIsLoaded(true)}
          className={twMerge(
            themeToMatch === "light" 
								? "dark:hidden" 
								: "hidden dark:block")
          }
          src={`/logos/${style}/logo${themeToMatch === "light" ? "_light" : ""}.png`}
          alt="logo"
          width={232}
          height={54}
        />
      ))}
    </Skeleton>
  );
}

export default function Footer() {
  const t = useTranslations("footer");
  const tNav = useTranslations("nav")
  const [isMounted, setIsMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <footer className="row-start-3 bg-white dark:bg-card h-full w-full flex justify-center items-center flex-col gap-6 xl:gap-14 py-12 xl:py-0">
      <div className="max-w-[96rem] px-14 flex w-full justify-between items-center flex-col gap-6 xl:gap-14 xl:flex-row">
        <div className="flex flex-col gap-6 h-full items-center xl:items-start">
          <Logo />
          <div className="flex flex-col gap-[0.875rem]">
            {Object.entries(footerInfo).map(([key, value]) => (
              <div key={key} className="flex gap-2 justify-center xl:justify-start">
                <span className="text-black/60 dark:text-white/60">
                  {t(key)}
                </span>
                <span className="text-black/60 dark:text-white/60 font-bold break-all text-wrap">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <FooterFieldColumn
          title={t("quickLinks")}
          content={
            <div className="flex flex-col gap-4 mt-6 items-center xl:items-start">
              {links[style as keyof typeof links].map(
                (link) =>
                  !link.footerExclude && (
                    <Link
                      href={link.href}
                      key={link.label}
                      className="text-black/60 dark:text-white/60 text-xl"
                    >
                      {tNav(link.label)}
                    </Link>
                  )
              )}
            </div>
          }
        />
        <div className="flex flex-col h-full gap-6 w-full xl:w-auto">
          <FooterFieldColumn
            title={t("stayConnected")}
            content={
              <div className="flex mt-6 gap-8">
                {socialLinks.map((link) => (
                  <Link href={link.href} key={link.label}>
                    <link.icon className="text-black/60 dark:text-white/60 w-6 h-6" />
                  </Link>
                ))}
              </div>
            }
          />
          <FooterFieldColumn
            title={t("contactUs")}
            content={
              <div className="mt-6">
                <Button
                  color={isMounted && theme === "light" ? "accent" : undefined}
                  className="px-12"
                >
                  {tNav("contactUs")}
                </Button>
              </div>
            }
          />
        </div>
      </div>
      <div className="flex gap-4">
        <Link className="text-black/60 dark:text-white/60 font-medium" href="/">
          {t("privacyPolicy")}
        </Link>
        <span className="font-medium text-black/60 dark:text-white/60">|</span>
        <Link className="text-black/60 dark:text-white/60 font-medium" href="/">
          {t("termsOfService")}
        </Link>
      </div>
    </footer>
  );
}
