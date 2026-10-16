import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Bookmark02Icon, BookmarkCheck01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/nextui/Button";
import { Item, ListItem } from "@/app/api/item/types";
import { useState, forwardRef } from "react";
import useSWRMutation from "swr/mutation";
import { setter } from "@/lib/utils";
import { twMerge } from "@/lib/tw-merge";
import { useReaderData } from "@/hooks/useReaderData";
import { useTranslations } from "next-intl";
import { Tooltip } from "@/components/nextui/Tooltip";

/** Whether the signed-in reader bookmarked the record, and the toggle that saves a change and reloads their lists. */
function useBookmark(itemData: Item | ListItem | undefined, revalidateResults?: () => unknown) {
  const [mutationLoading, setMutationLoading] = useState(false);
  // The state being saved, until the lists reload.
  const [saving, setSaving] = useState<boolean>();
  const { trigger } = useSWRMutation(`/reader/bookmarks`, setter);
  const { reader, data, refresh } = useReaderData();
  const saved = Boolean(itemData && data?.bookmarks[itemData.key]);

  const toggle = async () => {
    setMutationLoading(true);
    setSaving(!saved);
    try {
      await trigger({
        itemKey: itemData?.key,
      });
      await Promise.all([
        revalidateResults && revalidateResults(),
        refresh(),
      ]);
    } catch (error) {
      console.error(error);
    }
    setMutationLoading(false);
    setSaving(undefined);
  };

  return { reader, saved, saving, mutationLoading, toggle };
}

const LikeButton = forwardRef<
  any,
  { itemData: Item | ListItem | undefined; className?: any, revalidateResults?: any }
>(function LikeButton({ itemData, className, revalidateResults }, ref) {
  const { reader, saved: isLiked, mutationLoading, toggle } = useBookmark(itemData, revalidateResults);
  const t = useTranslations("ui");

  if (!reader) return null;

  return (
    <Button
      ref={ref}
      isLoading={mutationLoading}
      color={isLiked ? "accent" : "secondary"}
      isIconOnly
      size="sm"
      onPress={toggle}
      className={twMerge(className)}
      aria-label={isLiked ? t("removeBookmarkAction") : t("bookmarkAction")}
    >
      {!isLiked ? <HugeiconsIcon icon={Bookmark02Icon} /> : <HugeiconsIcon icon={BookmarkCheck01Icon} />}
    </Button>
  );
});

LikeButton.displayName = "LikeButton";

export default LikeButton;

/**
 * A small transparent bookmark icon with a tooltip, beside the other icons of a hover card. It shows the state it is
 * saving at once, rather than a spinner in its small space.
 */
export function CompactBookmarkButton({ itemData, className }: { itemData: Item | ListItem | undefined; className?: string }) {
  const { reader, saved, saving, mutationLoading, toggle } = useBookmark(itemData);
  const t = useTranslations("ui");
  if (!reader) return null;
  const isLiked = saving ?? saved;
  const label = isLiked ? t("removeBookmarkAction") : t("bookmarkAction");
  return (
    <Tooltip content={label}>
      <Button
        variant="transparent"
        isIconOnly
        // Not disabled while it saves, which would dim it: a second press just waits.
        onPress={mutationLoading ? undefined : toggle}
        className={twMerge(className, isLiked && "!text-accent")}
        aria-label={label}
        aria-pressed={isLiked}
      >
        <HugeiconsIcon icon={isLiked ? BookmarkCheck01Icon : Bookmark02Icon} className="size-3.5" />
      </Button>
    </Tooltip>
  );
}
