"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { twMerge } from "tailwind-merge";
import { links } from "@/constants/links";
import Dark from "@/components/icons/Dark";
import { useTheme } from "next-themes";

export default function Navbar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  return (
    <nav className="w-full max-w-screen-2xl px-14">
      <div className="h-[104px] bg-white dark:bg-secondary rounded-[20px] flex items-center p-8 gap-9">
        <Image src={theme === "dark" ? "/logo.png" : "/logo_light.png"} alt="logo" height={104} width={171} />
        <div className="flex flex-1 items-center justify-end gap-8 overflow-hidden">
          {links.map((link) => (
            !link.navExclude && <Link
              href={link.href}
              key={link.label}
              className={twMerge(
                "flex text-black/60 dark:text-white/60 gap-2 text-lg items-center justify-center font-medium",
                pathname === link.href && "text-accent"
              )}
            >
              {link.icon && <link.icon className="fill-current size-6 shrink-0" />}
              <span className="line-clamp-1">
              {link.label}
              </span>
            </Link>
          ))}
        </div>
        <Dark
          onClick={() => {
            setTheme(theme === "dark" ? "light" : "dark");
          }}
          className="h-6 w-6 fill-accent justify-end cursor-pointer"
        />
      </div>
    </nav>
  );
}
