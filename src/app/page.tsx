"use client";
import Navbar from "@/components/Navbar";
import Image from "next/image";
import Link from "next/link";
import { links, socialLinks } from "@/constants/links";
import {
  RiFacebookCircleFill,
  RiLinkedinBoxFill,
  RiTwitterXFill,
} from "react-icons/ri";
import { Button } from "@/components/nextui/Button";
import Resource from "@/components/Resource";
import Programmes from "@/components/Programmes";
import { SelectItem } from "@nextui-org/react";
import { BiSearch } from "react-icons/bi";
import { IoSearch } from "react-icons/io5";
import { LuHelpCircle } from "react-icons/lu";
import { Select } from "@/components/nextui/Select";
import { Input } from "@/components/nextui/Input";

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
    <div className="flex flex-col">
      <span className="text-primary/80 font-bold text-xl">{title}</span>
      {content}
    </div>
  );
}

export default function Home() {
  return (
    <div className="grid grid-rows-[104px_1fr_512px] gap-14 pt-14 items-center justify-items-center min-h-screen">
      <Navbar />
      <main className="w-full max-w-screen-2xl px-14">
        <div className="flex gap-[40px]">
          <Programmes />
          <div className="w-full">
            <div className="flex w-full justify-between items-end h-12">
              <h1 className="text-primary/60 font-medium text-3xl">Search</h1>
              <div className="flex gap-4 h-12 flex-1 justify-end">
                <Button
                  className="h-full px-6 font-medium text-base"
                  endContent={<LuHelpCircle className="size-6" />}
                >
                  Help
                </Button>
                <Select
                  items={[
                    { key: "newest", name: "Newest" },
                    { key: "oldest", name: "Oldest" },
                  ]}
                  defaultSelectedKeys={["newest"]}
                  startContent={
                    <div className="text-primary/60 shrink-0 font-medium">
                      Sort by:
                    </div>
                  }
                >
                  {(item: any) => {
                    return (
                      <SelectItem
                        classNames={{
                          title: "text-primary/60 font-medium text-base",
                        }}
                        key={item.key}
                      >
                        {item.name}
                      </SelectItem>
                    );
                  }}
                </Select>
              </div>
            </div>
            <div className="flex my-4 gap-4">
              <Input
                placeholder="Search"
                isClearable
                startContent={
                  <IoSearch className="size-6 fill-current text-primary/40" />
                }
              />
                <Select
                  items={[
                    { key: "newest", name: "Newest" },
                    { key: "oldest", name: "Oldest" },
                  ]}
                >
                  {(item: any) => {
                    return (
                      <SelectItem
                        classNames={{
                          title: "text-primary/60 font-medium text-base",
                        }}
                        key={item.key}
                      >
                        {item.name}
                      </SelectItem>
                    );
                  }}
                </Select>
            </div>
            <div className="flex flex-col gap-6">
              {Array.from({ length: 10 }).map((_, index) => (
                <Resource key={index} />
              ))}
            </div>
          </div>
        </div>
      </main>
      <footer className="row-start-3 bg-primary/[2%] h-full w-full flex justify-center items-center flex-col gap-14">
        <div className="max-w-screen-2xl px-14 flex w-full justify-between items-center">
          <div className="flex flex-col gap-6 h-full items-start">
            <Image src={"/logo.png"} alt="logo" width={232} height={81} />
            <div className="flex flex-col gap-[14px]">
              {Object.entries(footerInfo).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-primary/40">{key}</span>
                  <span className="text-primary/60 font-bold">{value}</span>
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
                        className="text-primary/40 text-xl"
                      >
                        {link.label}
                      </Link>
                    )
                )}
              </div>
            }
          />
          <div className="flex flex-col h-full gap-6">
            <FooterFieldColumn
              title="Stay Connected"
              content={
                <div className="flex mt-6 gap-8">
                  {socialLinks.map((link) => (
                    <Link href={link.href} key={link.label}>
                      <link.icon className="text-primary/40 w-6 h-6" />
                    </Link>
                  ))}
                </div>
              }
            />
            <FooterFieldColumn
              title="Contact Us"
              content={
                <div className="mt-6">
                  <Button className="px-12">Contact Us</Button>
                </div>
              }
            />
          </div>
        </div>
        <div className="flex gap-4">
          <Link className="text-primary/60 font-medium" href="/">
            Privacy Policy
          </Link>
          <span className="font-medium text-primary/10 ">|</span>
          <Link className="text-primary/60 font-medium" href="/">
            Terms of Service
          </Link>
        </div>
      </footer>
    </div>
  );
}
