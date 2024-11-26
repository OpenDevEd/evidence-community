"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { twMerge } from "tailwind-merge";
import { links } from "@/constants/links";
import Dark from "@/components/icons/Dark";
import { useTheme } from "next-themes";
import { HiOutlineMoon, HiOutlineSun } from "react-icons/hi2";
import { IoMdSunny } from "react-icons/io";
import { useState, useEffect } from "react";
import { Skeleton } from "@/components/nextui/Skeleton";
import { RxHamburgerMenu } from "react-icons/rx";
import { GiHamburgerMenu } from "react-icons/gi";

function ThemeSwitcher({
  theme,
  setTheme,
  isMounted,
  isMobile = false,
}: {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  isMounted: boolean;
  isMobile?: boolean;
}) {
  return (
    <Skeleton
      isLoaded={isMounted}
      className={twMerge(
        "h-6 w-6 rounded-lg",
        isMobile ? "xl:hidden block w-full" : "xl:block hidden"
      )}
      onClick={() => {
        setTheme(theme === "dark" ? "light" : "dark");
      }}
    >
      <div className="flex items-center justify-center gap-2">
        {[IoMdSunny, HiOutlineMoon].map(
          (Icon, index) =>
            isMounted && (
              <Icon
                key={index}
                className={twMerge(
                  "size-5 xl:size-6 cursor-pointer select-none active:scale-95 transition-all",
                  theme === "dark" ? "stroke-accent" : "fill-accent",
                  theme === "dark" && index === 0 && "hidden",
                  theme === "light" && index === 1 && "hidden"
                )}
              />
            )
        )}
        {isMobile && isMounted && (
          <span className="text-sm text-accent">
            Switch to {theme === "dark" ? "Light" : "Dark"} mode
          </span>
        )}
      </div>
    </Skeleton>
  );
}

function Logo({
  theme,
  isMounted,
}: {
  theme: string | undefined;
  isMounted: boolean;
}) {
  return (
    <Skeleton isLoaded={isMounted} className="w-[171px] h-[40px] rounded-lg">
      {isMounted && (
        <Image
          src={theme === "dark" ? "/logo.png" : "/logo_light.png"}
          alt="logo"
          height={40}
          width={171}
        />
      )}
    </Skeleton>
  );
}

function LinksList({
  pathname,
  isMobile = false,
}: {
  pathname: string;
  isMobile?: boolean;
}) {
  return (
    <div
      className={twMerge(
        "flex flex-1 items-center justify-end gap-8 overflow-hidden",
        isMobile && "flex-col gap-8",
        !isMobile && "hidden xl:flex"
      )}
    >
      {links.map(
        (link) =>
          !link.navExclude && (
            <Link
              href={link.href}
              key={link.label}
              className={twMerge(
                "flex text-black/60 dark:text-white/60 gap-2 text-lg items-center justify-center font-medium",
                pathname === link.href && "text-accent dark:text-accent"
              )}
            >
              {link.icon && (
                <link.icon className="fill-current size-6 shrink-0" />
              )}
              <span className="line-clamp-1">{link.label}</span>
            </Link>
          )
      )}
    </div>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [isMounted, setIsMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <nav className="w-full max-w-screen-2xl px-4 xl:px-14 z-10 ">
      <div className="h-[104px] bg-white dark:bg-secondary rounded-[20px] flex items-center p-8 gap-9 z-10">
        <Logo theme={theme} isMounted={isMounted} />
        <LinksList pathname={pathname} />
        <ThemeSwitcher
          theme={theme}
          setTheme={setTheme}
          isMounted={isMounted}
        />
        <GiHamburgerMenu
          className="xl:hidden block ml-auto size-6 !fill-accent !stroke-accent"
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        />
      </div>
      <div
        className={twMerge(
          "xl:hidden bg-[#EAE9E5] dark:bg-secondary-400 rounded-[20px] rounded-t-none relative duration-300 overflow-y-hidden -mt-4 -z-10 flex flex-col gap-8",
          isMobileMenuOpen
            ? "max-h-[calc(100vh-104px)] py-8 pt-12 opacity-100"
            : "max-h-0 mb-4 opacity-0"
        )}
      >
        <LinksList pathname={pathname} isMobile={true} />
        <ThemeSwitcher
          theme={theme}
          setTheme={setTheme}
          isMounted={isMounted}
          isMobile={true}
        />
      </div>
    </nav>
  );
}
