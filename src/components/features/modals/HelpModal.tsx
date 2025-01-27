"use client";

import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from "@nextui-org/react";
import { LuX } from "react-icons/lu";
import { SectionTitle } from "../../typography/SectionTitle";
import { Paragraph } from "../../typography/Paragraph";
import { Highlight } from "../../typography/Highlight";
import { ListItem } from "../../typography/ListItem";
import { Button } from "../../nextui/Button";

export default function HelpModal({ isOpen, onOpenChange }: { isOpen: boolean, onOpenChange: (open: boolean) => void }) {
  return <Modal
  size="4xl"
  scrollBehavior="inside"
  placement="top-center"
  hideCloseButton
  isOpen={isOpen}
  onOpenChange={onOpenChange}
  classNames={{
    base: "bg-background_light dark:bg-card xl:border border-black/10 dark:border-white/10 mx-0 my-0 rounded-none xl:rounded-large min-h-dvh xl:min-h-0",
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
            className="xl:px-0 px-0 translate-x-2"
            aria-label={"Close this popup"}
            startContent={
              <LuX className="size-6 text-black dark:text-white/80" />
            }
          />
        </ModalHeader>
        <ModalBody className="h-64">
          <Paragraph>
            The search interface is made of three sections:{" "}
            <Highlight>Search</Highlight>,{" "}
            <Highlight>Explore</Highlight>, and{" "}
            <Highlight>Results</Highlight>. These are described in
            detail below.
          </Paragraph>
          <Paragraph>
            You may start searching either from the{" "}
            <Highlight>Search</Highlight> section or from the{" "}
            <Highlight>Explore</Highlight> section.
          </Paragraph>
          <SectionTitle className="my-2">Search</SectionTitle>
          <Paragraph>
            This section shows your current search criteria and allows
            you to submit keywords to search in the library.
          </Paragraph>
          <ul className="list-disc pl-5">
            <ListItem>
              Each new submission adds the entered keywords to the
              list of search criteria.
            </ListItem>
            <ListItem>
              To start a new search instead of adding keywords to the
              current search, use the{" "}
              <Highlight>Remove Filter</Highlight> button, then enter
              your new keywords.
            </ListItem>
            <ListItem>
              To replace an already submitted keyword, first remove it
              by unchecking its checkbox, then submit a new keyword.
            </ListItem>
            <ListItem>
              You may control the extent of your search by selecting
              where to search. The options are:
              <ul className="list-none pl-5">
                <ListItem>
                  <Highlight>In Authors Or Contributors:</Highlight>{" "}
                  Search your keywords in author or contributor names.
                </ListItem>
                <ListItem>
                  <Highlight>In Titles:</Highlight> Search your
                  keywords in titles.
                </ListItem>
                <ListItem>
                  <Highlight>In All Fields:</Highlight> Search your
                  keywords in all bibliographic record fields.
                </ListItem>
                <ListItem>
                  <Highlight>In Documents:</Highlight> Search your
                  keywords in the text content of the available
                  documents.
                </ListItem>
              </ul>
            </ListItem>
            <ListItem>
              You may use boolean operators with your keywords. For
              instance:
              <ul className="list-none pl-5">
                <ListItem>
                  <Highlight>AND:</Highlight> Finds entries that
                  contain all specified terms. This is the default
                  relation between terms when no operator is
                  specified, e.g., A B is the same as A AND B.
                </ListItem>
                <ListItem>
                  <Highlight>OR:</Highlight> Finds entries that
                  contain any of the specified terms, e.g., A OR B.
                </ListItem>
                <ListItem>
                  <Highlight>NOT:</Highlight> Excludes entries that
                  contain the specified terms, e.g., NOT A.
                </ListItem>
              </ul>
              Boolean operators must be entered in uppercase.
            </ListItem>
            <ListItem>
              You may use logical groupings (with parentheses) to
              eliminate ambiguities when using multiple boolean
              operators, e.g., (A OR B) AND C.
            </ListItem>
            <ListItem>
              You may require exact sequences of words (with double
              quotes), e.g., &quot;A B C&quot;. The default difference between
              word positions is 1, meaning that an entry will match if
              it contains the words next to each other, but a
              different maximum distance may be specified (with the
              tilde character), e.g., &quot;Web Search&quot;~2 allows up to 1
              word between Web and Search, meaning it could match web
              site search as well as web search.
            </ListItem>
          </ul>

          <SectionTitle className="my-2">Explore</SectionTitle>
          <Paragraph>
            This section allows you to explore categories associated
            with the references.
          </Paragraph>
          <ul className="list-disc pl-5">
            <ListItem>
              Categories can be used to filter your search. Check a
              category to add it to your search criteria and narrow
              your search. Your search results will then only show
              entries that are associated with that category.
            </ListItem>
            <ListItem>
              Uncheck a category to remove it from your search
              criteria and broaden your search results.
            </ListItem>
            <ListItem>
              The numbers shown next to the categories indicate how
              many entries are associated with each category in the
              current set of results. Those numbers will vary based on
              your search criteria to always describe the current set
              of results. Likewise, categories and whole facets will
              disappear when the result set has no entries associated
              to them.
            </ListItem>
            <ListItem>
              An arrow icon (v) appearing next to a category indicates
              that subcategories are available. You may press it to
              expand a list of more specific categories. You may press
              it again later to collapse the list. Expanding or
              collapsing subcategories will not change your current
              search; this allows you to quickly explore a hierarchy
              of categories if desired.
            </ListItem>
          </ul>

          <SectionTitle className="my-2">Results</SectionTitle>
          <Paragraph>
            This section shows the search results. When no search
            criteria has been given, it shows the full content of the
            bibliography (up to 20 entries per page).
          </Paragraph>
          <ul className="list-disc pl-5">
            <ListItem>
              Each entry of the results list is a link to its full
              bibliographic record. From the bibliographic record
              view, you may continue exploring the search results by
              going to previous or following records in your search
              results, or you may return to the list of results.
            </ListItem>
            <ListItem>
              Additional links, such as{" "}
              <Highlight>Read document</Highlight> or{" "}
              <Highlight>View on [website name]</Highlight>, may
              appear under a result. These give you quick access to
              the resource. Those links will also be available in the
              full bibliographic record.
            </ListItem>
            <ListItem>
              The <Highlight>Abstracts</Highlight> button lets you
              toggle the display of abstracts within the list of
              search results. Enabling abstracts, however, will have
              no effect on results for which no abstract is available.
            </ListItem>
            <ListItem>
              Various options are provided to let you sort the search
              results. One of them is the{" "}
              <Highlight>Relevance</Highlight> option, which ranks the
              results from most relevant to least relevant. The score
              used for ranking takes into account word frequencies as
              well as the fields where they appear. For instance, if a
              search term occurs frequently in an entry or is one of
              very few terms used in that entry, that entry will
              probably rank higher than another where the search term
              occurs less frequently or where lots of other words also
              occur. Likewise, a search term will have more effect on
              the scores if it is rare in the whole bibliography than
              if it is very common. Also, if a search term appears in,
              e.g., the title of an entry, it will have more effect on
              the score of that entry than if it appeared in a less
              important field such as the abstract.
            </ListItem>
            <ListItem>
              The <Highlight>Relevance</Highlight> sort is only
              available after keywords have been submitted using the{" "}
              <Highlight>Search</Highlight> section.
            </ListItem>
            <ListItem>
              Categories selected in the{" "}
              <Highlight>Explore</Highlight> section have no effect on
              the relevance score. Their only effect is to filter the
              list of results.
            </ListItem>
          </ul>
        </ModalBody>
        <ModalFooter>
          <Button color="accent" fullWidth onPress={onClose}>
            Close
          </Button>
        </ModalFooter>
      </>
    )}
  </ModalContent>
</Modal>
}
