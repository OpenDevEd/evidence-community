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
import { Skeleton } from "@nextui-org/react";

function ThemeSwitcher({ theme, setTheme, isMounted }: { theme: string | undefined, setTheme: (theme: string) => void, isMounted: boolean }) {
  return (
    <Skeleton isLoaded={isMounted} className="h-6 w-6 rounded-lg">
      {[IoMdSunny, HiOutlineMoon].map((Icon, index) => (
        isMounted && (
          <Icon
            key={index}
            onClick={() => {
            setTheme(theme === "dark" ? "light" : "dark");
          }}
          className={twMerge(
            "h-6 w-6 cursor-pointer select-none active:scale-95 transition-all",
            theme === "dark" ? "stroke-accent" : "fill-accent",
            theme === "dark" && index === 0 && "hidden",
            theme === "light" && index === 1 && "hidden"
          )}
          />
        )
      ))}
    </Skeleton>
  );
}

function Logo({ theme, isMounted }: { theme: string | undefined, isMounted: boolean }) {
  return (
    <Skeleton isLoaded={isMounted} className="w-[171px] h-[40px] rounded-lg">
      {isMounted && (
        <Image
          src={theme === "dark" ? "/logo.png" : "/logo_light.png"}
          alt="logo"
          height={40}
          width={171} />
      )}
    </Skeleton>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const [isMounted, setIsMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <nav className="w-full max-w-screen-2xl px-14">
      <div className="h-[104px] bg-white dark:bg-secondary rounded-[20px] flex items-center p-8 gap-9">
        <Logo theme={theme} isMounted={isMounted} />
        <div className="flex flex-1 items-center justify-end gap-8 overflow-hidden">
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
        <ThemeSwitcher theme={theme} setTheme={setTheme} isMounted={isMounted} />
      </div>
    </nav>
  );
}
