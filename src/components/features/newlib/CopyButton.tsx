"use client";

import { Button } from "@heroui/react";
import { FiCopy, FiCheck } from "react-icons/fi";
import { useState } from "react";
import { ReactElement, cloneElement } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { twMerge } from "tailwind-merge";

interface CopyButtonProps {
    textToCopy: string;
    className?: string;
    children?: ReactElement<any>;
    ariaLabel?: string;
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
                        <FiCheck className="text-success" />
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
                        <FiCopy />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

export default function CopyButton({ textToCopy, className, children, ariaLabel }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(textToCopy);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text:', err);
        }
    };

    if (children) {
        return cloneElement(children, {
            onPress: handleCopy,
            startContent: <CopyIcon copied={copied} />,
            ...(children.props as object),
            ariaLabel: ariaLabel
        });
    }

    return (
        <Button
            isIconOnly
            variant="light"
            size="sm"
            className={twMerge("rounded-full", className)}
            onPress={handleCopy}
            aria-label={ariaLabel}
        >
            <CopyIcon copied={copied} />
        </Button>
    );
} 