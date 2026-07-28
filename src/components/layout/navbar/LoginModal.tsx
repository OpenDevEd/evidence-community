"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence } from "framer-motion";
import { signIn } from "next-auth/react";
import { ModalContent, ModalBody } from "@nextui-org/react";
import { FaGoogle, FaEnvelope, FaLock } from "react-icons/fa";
import { Button } from "@/components/nextui/Button";
import { Input } from "@/components/nextui/Input";
import DialogModal from "@/components/nextui/DialogModal";
import GenericHeader from "@/components/features/modals/GenericHeader";
import { Logo } from "./Logo";
import { authenticate } from "@/lib/auth";
import { useModalError } from "@/hooks/useModalError";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";

interface LoginModalProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onClose: () => void;
}

export default function LoginModal({
	isOpen,
	onOpenChange,
	onClose,
}: LoginModalProps) {
	const t = useTranslations("ui");
	const tAuth = useTranslations("auth");
	const { authentication, features } = useLibraryConfig();
	const [loading, setLoading] = useState(false);
	const {
		displayOnError,
		errorClassName,
		ErrorField,
		containerRef,
		errorMessage,
	} = useModalError({
		initial: {
			height: 0,
			opacity: 0,
			y: 8,
		},
		animate: { height: "auto", opacity: 1 },
		exit: { height: 0, opacity: 0, y: 0 },
	});
	const googleEnabled = authentication.google.enabled;

	if (!features.login) return null;

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		setLoading(true);
		try {
			const formData = new FormData(e.target as HTMLFormElement);
			const email = formData.get("email") as string;
			const password = formData.get("password") as string;
			const submitButton = document.activeElement as HTMLButtonElement;
			const isRegister = submitButton.hasAttribute("data-register");

			const result = await authenticate({
				email,
				password,
				register: isRegister,
			});

			const errors = (
				result?.error
					? result.error
							.split(", ")
							.map((error: string) => tAuth(error))
					: []
			).join("\n");

			if (!displayOnError(errors)) {
				onClose();
			}
		} catch (error: any) {
			console.error(error);
		} finally {
			setLoading(false);
		}
	};

	return (
		<DialogModal size="md" isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent className={errorClassName}>
				<GenericHeader onClose={onClose}>
					<div className="scale-75 origin-bottom-left">
						<Logo interactive={false} />
					</div>
				</GenericHeader>
				<ModalBody>
					<div ref={containerRef} className="flex flex-col gap-2 pb-4">
						<div>
							<form onSubmit={handleSubmit} className="flex flex-col gap-2">
								<Input
									startContent={
										<FaEnvelope
											aria-hidden="true"
											className="size-5 ltr:mr-1 rtl:ml-1 fill-black dark:fill-white/40"
										/>
									}
									name="email"
									placeholder="Email"
								/>
								<Input
									startContent={
										<FaLock
											aria-hidden="true"
											className="size-5 ltr:mr-1 rtl:ml-1 fill-black dark:fill-white/40"
										/>
									}
									type="password"
									name="password"
									placeholder="Password"
								/>
								<div className="flex items-center gap-2 h-10">
									<Button
										isDisabled={loading}
										color="accent"
										className="w-full h-full"
										type="submit"
									>
										{t("login")}
									</Button>
									<Button
										isDisabled={loading}
										color="secondary"
										className="w-full h-full"
										data-register
										type="submit"
									>
										{t("register")}
									</Button>
								</div>
							</form>
							<AnimatePresence mode="sync">
								{errorMessage && <ErrorField />}
							</AnimatePresence>
						</div>
						{googleEnabled ? (
							<>
								<div className="flex items-center gap-4 my-4">
									<div className="flex-1 h-[0.0625rem] bg-black/10 dark:bg-white/10" />
									<span className="text-black/60 dark:text-white/60">
										{t("or")}
									</span>
									<div className="flex-1 h-[0.0625rem] bg-black/10 dark:bg-white/10" />
								</div>
								<Button
									onPress={() => signIn("google")}
									color="secondary"
									className="w-full dark:bg-white dark:text-black"
									startContent={
										<FaGoogle className="size-5" />
									}
								>
									{t("continueWithGoogle")}
								</Button>
							</>
						) : null}
					</div>
				</ModalBody>
			</ModalContent>
		</DialogModal>
	);
}
