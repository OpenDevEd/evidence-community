import { Button } from "@/components/nextui/Button";
import { Item } from "@/app/api/item/types";
import { FaHeart, FaHeartBroken } from "react-icons/fa";
import { useState, forwardRef } from "react";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import { setter } from "@/lib/utils";
import { twMerge } from "tailwind-merge";
import { BsBookmarkCheckFill, BsBookmarkFill } from "react-icons/bs";
import { useSWRConfig } from "swr";

const LikeButton = forwardRef<
  any,
  { itemData: Item | undefined; className?: any, revalidateResults?: any }
>(function LikeButton({ itemData, className, revalidateResults }, ref) {
  const [mutationLoading, setMutationLoading] = useState(false);
  const { trigger } = useSWRMutation(`/like`, setter);
  const { data: session, update } = useSession();
  const isLiked = itemData && session?.user.likes[itemData.key];

  const handleLike = async (e: any) => {
    setMutationLoading(true);
    try {
      await trigger({
        itemKey: itemData?.key,
      });
      await Promise.all([
        revalidateResults && revalidateResults(),
        update(),
      ]);
    } catch (error) {
      console.error(error);
    }
    setMutationLoading(false);
  };

  if (!session) return null;

  return (
    <Button
      ref={ref}
      isLoading={mutationLoading}
      color={isLiked ? "accent" : "secondary"}
      isIconOnly
      size="sm"
      onPress={handleLike}
      className={twMerge(className)}
    >
      {!isLiked ? <BsBookmarkFill /> : <BsBookmarkCheckFill />}
    </Button>
  );
});

LikeButton.displayName = "LikeButton";

export default LikeButton; 