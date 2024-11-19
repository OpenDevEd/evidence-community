"use client";

import { Accordion, AccordionItem, CheckboxGroup } from "@nextui-org/react";
import { Checkbox } from "./nextui/Checkbox";
import AboutUs from "./icons/AboutUs";
import { BiCheck, BiDownArrow } from "react-icons/bi";
import { Button } from "./nextui/Button";
import { VscChevronDown, VscChevronLeft } from "react-icons/vsc";

export default function Programmes() {
  return (
    <div className="w-[456px] shrink-0">
      <Accordion
        defaultExpandedKeys={["1", "2", "3", "4"]}
        selectionMode="multiple"
        fullWidth={false}
        variant="shadow"
        className="bg-white dark:bg-white/[2%] p-6 rounded-xl shadow-none"
        itemClasses={{
          title: "text-black/80 dark:text-white/80 font-base text-2xl",
          indicator: "text-black/80 dark:text-white/80",
          trigger: "p-0",
          base: "mb-4 last:mb-0",
          content: "pt-4",
        }}
        showDivider={false}
      >
        <AccordionItem key="1" indicator={<VscChevronLeft className="size-8" />} title="Our Programmes">
          <div className="flex flex-col gap-4">
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
            <Button className="bg-black/[4%]">
              See More
              <VscChevronDown className="size-6" />
            </Button>
          </div>
        </AccordionItem>
        <AccordionItem key="2" indicator={<VscChevronLeft className="size-8" />} title="Our Programmes">
          <div className="flex flex-col gap-4">
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
          </div>
        </AccordionItem>
        <AccordionItem key="3" indicator={<VscChevronLeft className="size-8" />} title="Our Programmes">
          <div className="flex flex-col gap-4">
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
          </div>
        </AccordionItem>
        <AccordionItem key="4" indicator={<VscChevronLeft className="size-8" />} title="Our Programmes">
          <div className="flex flex-col gap-4">
            <Checkbox value="1">21st century learning in Zambia</Checkbox>
            <Checkbox size="lg" value="4">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="5">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox size="lg" value="6">
              21st century learning in Zambia
            </Checkbox>
            <Checkbox value="2">21st century learning in Zambia</Checkbox>
            <Checkbox value="3">21st century learning in Zambia</Checkbox>
          </div>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
