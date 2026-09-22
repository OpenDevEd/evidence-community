"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Copy01Icon, Tick01Icon } from "@hugeicons/core-free-icons";
import { Button, type ButtonProps } from "@nextui-org/react";
import { useClipboardFeedback } from "@/hooks/useClipboardFeedback";
import { ReactElement, cloneElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";

interface CopyButtonProps {
    textToCopy: string;
    isDisabled?: boolean;
    className?: string;
    children?: ReactElement<ButtonProps>;
    ariaLabel?: string;
    label?: string;
}

function CopyIcon({ copied }: { copied: boolean }) {
    return (
        <div className="relative w-4 h-4">
            <AnimatePresence initial={false} mode="wait">
                {copied ? (
                    <motion.div
                        key="check"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ 
                            type: "spring",
                            duration: 0.15,
                            bounce: 0.3
                        }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <HugeiconsIcon icon={Tick01Icon} className="text-success" />
                    </motion.div>
                ) : (
                    <motion.div
                        key="copy"
                        initial={{ scale: 0.5, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.5, opacity: 0 }}
                        transition={{ 
                            type: "spring",
                            duration: 0.15,
                            bounce: 0.3
                        }}
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <HugeiconsIcon icon={Copy01Icon} />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function CopyButton({ textToCopy, className, children, ariaLabel, label, isDisabled }: CopyButtonProps) {
    const { copy, copied } = useClipboardFeedback();
    const t = useTranslations("ui");
    const handleCopy = () => copy(textToCopy);

    if (children) {
        return cloneElement(children, {
            ...children.props,
            onPress: handleCopy,
            isDisabled: isDisabled || children.props.isDisabled,
            startContent: <CopyIcon copied={copied} />,
            ...((copied || ariaLabel) ? { "aria-label": copied ? t("copied") : ariaLabel } : {}),
            children: label ?? children.props.children
        });
    }

    return (
        <Button
            isIconOnly
            isDisabled={isDisabled}
            variant="light"
            size="sm"
            className={twMerge("rounded-full", className)}
            onPress={handleCopy}
            aria-label={copied ? t("copied") : ariaLabel}
        >
            <CopyIcon copied={copied} />
            {label}
        </Button>
    );
} 