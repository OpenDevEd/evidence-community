"use client";

import { Button } from "../nextui/Button";
import { FaTimesCircle, FaCheckCircle } from "react-icons/fa";
import DialogModal from "../nextui/DialogModal";
import GenericHeader from "../features/modals/GenericHeader";
import {
	ModalBody,
	ModalContent,
	ModalFooter,
	useDisclosure,
} from "@nextui-org/react";
import { useLocalStorage } from "@uidotdev/usehooks";
import { useEffect } from "react";
import { MdPrivacyTip } from "react-icons/md";
import { Logo } from "./Navbar";
import posthog from "posthog-js";

export function cookieConsentGiven() {
	if (!localStorage.getItem("cookie_consent")) {
		return "undecided";
	}
	return localStorage.getItem("cookie_consent");
}

export function getPersistence() {
	if (cookieConsentGiven() === "opted-in") {
		return "localStorage+cookie";
	}
	return "memory";
}

export type CookieConsent = "undecided" | "opted-in" | "opted-out";

export default function Banner() {
	const { isOpen, onOpenChange, onOpen, onClose } = useDisclosure();
	const [optedStatus, setOptedStatus] = useLocalStorage(
		"posthog-opted",
		"undecided"
	);

	useEffect(() => {
		if (optedStatus === "undecided") {
			onOpen();
		}
		if (optedStatus === "opted-in") {
			posthog.set_config({
				persistence: getPersistence(),
			});
		}
	}, [optedStatus]);

	return (
		<DialogModal
			scrollBehavior="inside"
			isDismissable={false}
			isKeyboardDismissDisabled={true}
			size="xl"
			isOpen={isOpen}
			backdrop="blur"
			onOpenChange={onOpenChange}
			classNames={{
				base: "backdrop-blur-xl bg-background_light/60 dark:bg-card/60 border border-divider",
			}}
		>
			<ModalContent className="p-6 pb-4">
				<div className="flex justify-center p-4">
					<Logo dbStyle="splash" />
				</div>
				<GenericHeader
					classNames={{
						base: "justify-center",
					}}
				>
					Help Us Improve Your Experience
				</GenericHeader>
				<ModalBody>
					<p className="text-center text-default-500 mx-auto max-w-md mb-6">
						{`We'd love your help in making our site better! With your
						permission, we'll collect anonymous usage data using
						analytics tools like PostHog to enhance your experience.
						Your privacy matters to us, and we handle all data
						according to our Privacy Policy.`}
					</p>
					<div className="mb-4">
						<h4 className="text-center font-medium mb-5 text-sm uppercase tracking-wide text-default-600">
							Why we use your data
						</h4>
						<div className="flex flex-wrap justify-center gap-3 max-w-lg mx-auto">
							<div className="flex items-center bg-gradient-to-r from-blue-100 to-blue-50 dark:from-blue-900/30 dark:to-blue-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									Improve usability
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-purple-100 to-purple-50 dark:from-purple-900/30 dark:to-purple-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									Understand preferences
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-emerald-100 to-emerald-50 dark:from-emerald-900/30 dark:to-emerald-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									Create new features
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-amber-100 to-amber-50 dark:from-amber-900/30 dark:to-amber-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									Personalize experience
								</span>
							</div>
							<div className="flex items-center bg-gradient-to-r from-rose-100 to-rose-50 dark:from-rose-900/30 dark:to-rose-800/20 px-4 py-2.5 rounded-full shadow-sm">
								<span className="text-xs font-medium">
									Fix bugs faster
								</span>
							</div>
						</div>
					</div>
				</ModalBody>
				<ModalFooter className="justify-center items-center flex-col gap-2 pt-2">
					<Button
						color="tertiary"
						onPress={() => {
							setOptedStatus("opted-in");
							onClose();
						}}
						className="px-6 font-medium"
					>
						Accept & Continue
					</Button>
					<Button
						size="sm"
						variant="transparent"
						onPress={() => {
							setOptedStatus("opted-out");
							onClose();
						}}
					>
						Decline
					</Button>
				</ModalFooter>
			</ModalContent>
		</DialogModal>
	);
}
