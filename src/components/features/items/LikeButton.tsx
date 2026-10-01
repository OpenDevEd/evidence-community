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

const LikeButton = forwardRef<
  any,
  { itemData: Item | ListItem | undefined; className?: any, revalidateResults?: any }
>(function LikeButton({ itemData, className, revalidateResults }, ref) {
  const [mutationLoading, setMutationLoading] = useState(false);
  const { trigger } = useSWRMutation(`/reader/bookmarks`, setter);
  const { reader, data, mutate } = useReaderData();
  const isLiked = Boolean(itemData && data?.bookmarks[itemData.key]);
  const t = useTranslations("ui");

  const handleLike = async (e: any) => {
    setMutationLoading(true);
    try {
      await trigger({
        itemKey: itemData?.key,
      });
      await Promise.all([
        revalidateResults && revalidateResults(),
        mutate(),
      ]);
    } catch (error) {
      console.error(error);
    }
    setMutationLoading(false);
  };

  if (!reader) return null;

  return (
    <Button
      ref={ref}
      isLoading={mutationLoading}
      color={isLiked ? "accent" : "secondary"}
      isIconOnly
      size="sm"
      onPress={handleLike}
      className={twMerge(className)}
      aria-label={isLiked ? t("removeBookmarkAction") : t("bookmarkAction")}
    >
      {!isLiked ? <HugeiconsIcon icon={Bookmark02Icon} /> : <HugeiconsIcon icon={BookmarkCheck01Icon} />}
    </Button>
  );
});

LikeButton.displayName = "LikeButton";

export default LikeButton; 
