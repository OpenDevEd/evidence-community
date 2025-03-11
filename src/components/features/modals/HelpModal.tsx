"use client";

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@nextui-org/react";
import { LuX } from "react-icons/lu";
import { SectionTitle } from "../../typography/SectionTitle";
import { Paragraph } from "../../typography/Paragraph";
import { Highlight } from "../../typography/Highlight";
import { ListItem } from "../../typography/ListItem";
import { Button } from "../../nextui/Button";
import { useTranslations } from "next-intl";

export default function HelpModal({ isOpen, onOpenChange }: { isOpen: boolean, onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("ui");
  const tHelp = useTranslations("help");

  const HELP_CONTENT = [
    {
      intro: [
        tHelp("intro1"),
        tHelp("intro2")
      ],
    },
    {
      title: tHelp("searchTitle"),
      description: tHelp("searchDesc"),
      items: [
        tHelp("search1"),
        tHelp("search2"),
        tHelp("search3"),
        {
          text: tHelp("search4"),
          listStyle: "list-none",
          subitems: [
            tHelp("search5"),
            tHelp("search6"),
            tHelp("search7"),
            tHelp("search8")
          ]
        },
        {
          text: tHelp("search9"),
          listStyle: "list-none",
          subitems: [
            tHelp("search10"),
            tHelp("search11"),
            tHelp("search12")
          ]
        },
        tHelp("search13"),
        tHelp("search14"),
        tHelp("search15")
      ]
    },
    {
      title: tHelp("exploreTitle"),
      description: tHelp("exploreDesc"),
      items: [
        tHelp("explore1"),
        tHelp("explore2"),
        tHelp("explore3"),
        tHelp("explore4")
      ]
    },
    {
      title: tHelp("resultsTitle"),
      description: tHelp("resultsDesc"),
      items: [
        tHelp("results1"),
        tHelp("results2"),
        tHelp("results3"),
        tHelp("results4"),
        tHelp("results5"),
        tHelp("results6")
      ]
    }
  ];

  return <Modal
  size="4xl"
  scrollBehavior="inside"
  placement="top-center"
  hideCloseButton
  isOpen={isOpen}
  onOpenChange={onOpenChange}
  classNames={{
    base: "bg-background_light dark:bg-card lg:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none lg:rounded-large min-h-dvh lg:min-h-0",
  }}
>
  <ModalContent>
    {(onClose) => (
      <>
        <ModalHeader className="flex items-center justify-between gap-2">
          <SectionTitle>Help</SectionTitle>
          <Button
            onPress={onClose}
            isIconOnly
            variant="transparent"
            className="lg:px-0 px-0 translate-x-2"
            aria-label={t("closePopupAriaLabel")}
            startContent={
              <LuX className="size-6 text-black dark:text-white/80" />
            }
          />
        </ModalHeader>
        <ModalBody className="h-64">
          {HELP_CONTENT.map((section, sectionIndex) => (
            <div key={sectionIndex}>
              {section.intro && section.intro.map((text, i) => (
                <Paragraph key={i}>
                  {text.split('**').map((part, j) => (
                    j % 2 === 0 ? part : <Highlight key={j}>{part}</Highlight>
                  ))}
                </Paragraph>
              ))}
              
              {section.title && (
                <SectionTitle className="my-2">{section.title}</SectionTitle>
              )}
              
              {section.description && (
                <Paragraph>{section.description}</Paragraph>
              )}
              
              {section.items && (
                <ul className="list-disc pl-5">
                  {section.items.map((item, itemIndex) => (
                    <ListItem key={itemIndex}>
                      {typeof item === 'string' ? (
                        item.split('**').map((part, j) => (
                          j % 2 === 0 ? part : <Highlight key={j}>{part}</Highlight>
                        ))
                      ) : (
                        <>
                          {item.text}
                          {item.subitems && (
                            <ul className={`pl-5 ${item.listStyle || 'list-disc'}`}>
                              {item.subitems.map((subitem, subIndex) => (
                                <ListItem key={subIndex}>
                                  {subitem.split('**').map((part, j) => (
                                    j % 2 === 0 ? part : <Highlight key={j}>{part}</Highlight>
                                  ))}
                                </ListItem>
                              ))}
                            </ul>
                          )}
                        </>
                      )}
                    </ListItem>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </ModalBody>
        <ModalFooter>
          <Button color="accent" fullWidth onPress={onClose}>
            {t("close")}
          </Button>
        </ModalFooter>
      </>
    )}
  </ModalContent>
</Modal>
}
