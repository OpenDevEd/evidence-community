import { Button } from "@/components/nextui/Button";
import { Item } from "@/app/api/item/types";
import { FaHeart, FaHeartBroken } from "react-icons/fa";
import { useState, forwardRef } from "react";
import useSWRMutation from "swr/mutation";
import { useSession } from "next-auth/react";
import { setter } from "@/lib/utils";
import { twMerge } from "tailwind-merge";

const LikeButton = forwardRef<
  HTMLButtonElement,
  { itemData: Item | undefined; className?: any }
>(function LikeButton({ itemData, className }, ref) {
  const [mutationLoading, setMutationLoading] = useState(false);
  const { trigger } = useSWRMutation(`/like`, setter);
  const { data: session, update } = useSession();
  const isLiked = itemData && session?.user.likes[itemData.key];

  const handleLike = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setMutationLoading(true);
    try {
      await trigger({
        itemKey: itemData?.key,
      });
      await update();
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
      onClick={handleLike}
      className={twMerge(className)}
    >
      {isLiked ? <FaHeartBroken /> : <FaHeart />}
    </Button>
  );
});

LikeButton.displayName = "LikeButton";

export default LikeButton; 