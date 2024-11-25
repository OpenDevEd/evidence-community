"use client";
import Image from "next/image";
import Link from "next/link";
import { links, socialLinks } from "@/constants/links";
import { Button } from "@/components/nextui/Button";
import { useTheme } from "next-themes";
import { useEffect } from "react";
import { useState } from "react";

const footerInfo = {
  Email: "opendeved@gmail.com",
  Phone: "+1-123-456-7890",
  Address: "123 Creativity Lane, Designville",
};

function FooterFieldColumn({
  title,
  content,
}: {
  title: string;
  content: React.ReactNode;
}) {
  return (
    <div className="flex flex-col w-full xl:w-auto">
      <span className="text-black/80 dark:text-white/80 font-bold text-xl">
        {title}
      </span>
      {content}
    </div>
  );
}

export default function Footer() {
  const [isMounted, setIsMounted] = useState(false);
  const { theme } = useTheme();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <footer className="row-start-3 bg-white dark:bg-white/[2%] h-full w-full flex justify-center items-center flex-col gap-14 py-14 xl:py-0">
      <div className="max-w-screen-2xl px-14 flex w-full justify-between items-center flex-col gap-14 xl:gap-0 xl:flex-row">
        <div className="flex flex-col gap-6 h-full items-start">
          <Image src={"/logo.png"} alt="logo" width={232} height={81} />
          <div className="flex flex-col gap-[14px]">
            {Object.entries(footerInfo).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <span className="text-black/60 dark:text-white/60">{key}</span>
                <span className="text-black/60 dark:text-white/60 font-bold">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
        <FooterFieldColumn
          title="Quick Links"
          content={
            <div className="flex flex-col gap-4 mt-6">
              {links.map(
                (link) =>
                  !link.footerExclude && (
                    <Link
                      href={link.href}
                      key={link.label}
                      className="text-black/60 dark:text-white/60 text-xl"
                    >
                      {link.label}
                    </Link>
                  )
              )}
            </div>
          }
        />
        <div className="flex flex-col h-full gap-14 xl:gap-6 w-full xl:w-auto">
          <FooterFieldColumn
            title="Stay Connected"
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
            title="Contact Us"
            content={
              <div className="mt-6">
                <Button
                  color={isMounted && theme === "light" ? "accent" : undefined}
                  className="px-12"
                >
                  Contact Us
                </Button>
              </div>
            }
          />
        </div>
      </div>
      <div className="flex gap-4">
        <Link className="text-black/60 dark:text-white/60 font-medium" href="/">
          Privacy Policy
        </Link>
        <span className="font-medium text-black/60 dark:text-white/60">|</span>
        <Link className="text-black/60 dark:text-white/60 font-medium" href="/">
          Terms of Service
        </Link>
      </div>
    </footer>
  );
}
