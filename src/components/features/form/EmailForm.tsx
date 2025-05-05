
"use client";

import { AnyFieldApi, FormApi, useForm } from "@tanstack/react-form";
import { z, ZodError } from "zod";
import { Input } from "@/components/nextui/Input";
import { Card } from "@/components/nextui/Card";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { useModalError } from "@/hooks/useModalError";
import { AnimatePresence, motion } from "framer-motion";
import { BiLink, BiMessageSquare, BiSolidSend, BiUser } from "react-icons/bi";
import { areLinksValid, sendTakedownRequest } from "@/lib/actions";
import { Spinner } from "@nextui-org/react";
import { toast } from "@/components/layout/Toast";
import { takedownRequestSchema } from "@/lib/utils";
import { MdEmail } from "react-icons/md";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";

const LINK_SEPARATOR = "\t• ";

function formatLinkErrors(
	links: string[],
	invalidItems: any[],
	getIndex: (item: any) => number,
	errorType: string = "Invalid"
): string | null {
	const invalidLinks = invalidItems.map((item) => ({
		url: links[getIndex(item)],
		index: getIndex(item) + 1,
	}));

	if (invalidLinks.length > 0) {
		return `${errorType}\n${LINK_SEPARATOR}${invalidLinks
			.map((v) => `${v.url} (${v.index})`)
			.join(`\n${LINK_SEPARATOR}`)}`;
	}

	return null;
}

function FieldInfo({ field }: { field: AnyFieldApi }) {
	"use no memo";
	const t = useTranslations("ui");

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
		},
		animate: { height: "auto", opacity: 1 },
		exit: { height: 0, opacity: 0 },
	});

	const showValidating = field.state.meta.isValidating;
	const showError =
		field.state.meta.isTouched && field.state.meta.errors.length;

	const getErrorMessage = (value: unknown) => {
		if (typeof value === "object" && value !== null && "message" in value) {
			return value.message;
		}

		return String(value);
	};

	return (
		<AnimatePresence>
			{showError || showValidating ? (
				<motion.div
					className="w-full relative"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
				>
					<AnimatePresence mode="popLayout">
						{showError ? (
							<ErrorField
								key="error"
								customMessage={field.state.meta.errors
									.map(getErrorMessage)
									.join(", ")}
							/>
						) : null}
						{showValidating ? (
							<motion.div
								key="validating"
								className="w-full"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
							>
								<Card className="p-4 flex items-center flex-row gap-2">
									<Spinner size="sm" />
									<p className="text-sm">{t("validating")}</p>
								</Card>
							</motion.div>
						) : null}
					</AnimatePresence>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function InputField({
	label,
	field,
	startContent,
}: {
	label: string;
	field: AnyFieldApi;
	startContent?: React.ReactNode;
}) {
	"use no memo";

	return (
		<>
			<Input
				id={field.name}
				name={field.name}
				value={field.state.value}
				onValueChange={(value: string) => field.handleChange(value)}
				isInvalid={
					field.state.meta.isTouched &&
					field.state.meta.errors.length > 0
				}
				label={label}
				startContent={startContent}
			/>
			<FieldInfo field={field} />
		</>
	);
}

function TextareaField({
	label,
	field,
	startContent,
}: {
	label: string;
	field: AnyFieldApi;
	startContent?: React.ReactNode;
}) {
	"use no memo";

	return (
		<>
			<Textarea
				id={field.name}
				isInvalid={
					field.state.meta.isTouched &&
					field.state.meta.errors.length > 0
				}
				name={field.name}
				value={field.state.value}
				onValueChange={(value: string) => field.handleChange(value)}
				label={label}
				startContent={startContent}
			/>
			<FieldInfo field={field} />
		</>
	);
}

const defaultValues = {
    email: "",
    links: "",
    description: "",
} as const;

export default function EmailForm({ fields, header, subtitle, footer, onSubmit }: { fields: (keyof typeof defaultValues)[], header?: string, subtitle?: string, footer?: React.ReactNode, onSubmit: (value: typeof defaultValues, reset: () => void) => Promise<void> }) {
	"use no memo";
	const t = useTranslations("ui");

	const fieldsMap = useMemo(() => {
		return fields.reduce((acc, field) => {
			acc[field] = true;
			return acc;
		}, {} as Record<string, boolean>);
	}, [fields]);

	const form = useForm({
		defaultValues: {
            email: "",
            links: "",
            description: "",
        },
		onSubmit: async ({ value, formApi }) => {
			await onSubmit(value as typeof defaultValues, () => formApi.reset());
		},
	});

	return (
		<Card
			color="card"
			className="w-full p-8 md:p-16 flex items-center justify-center"
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					e.stopPropagation();
					void form.handleSubmit();
				}}
				className="w-full max-w-2xl flex flex-col gap-6 items-center"
			>
				<div className="flex flex-col items-center gap-2 mb-4">
					<BiMessageSquare className="w-12 h-12 text-accent" />
					<h1 className="text-3xl font-bold text-center">
						{header || t("takedownRequest")}
					</h1>
					<p className="text-sm opacity-80 text-center max-w-md">
						{subtitle || t("fillFormBelow")}
					</p>
				</div>

				<div className="w-full space-y-6">
					{fieldsMap.email && (
						<form.Field
							name="email"
							validators={{
								onSubmit: z
									.string()
									.email({ message: t("invalidEmail") }),
							}}
						>
							{(field) => (
								<InputField
									startContent={
										<MdEmail className="text-accent/80" />
									}
									label={t("email")}
									field={field}
								/>
							)}
						</form.Field>
					)}
					{fieldsMap.links && (
						<form.Field
							name="links"
							validators={{
								onChangeAsyncDebounceMs: 500,
								onChangeAsync: async ({ value }) => {
									if (!value) {
										return t("enterLinks");
									}

									const links = value
										.split("\n")
										.filter(Boolean);
									// zod link validation
									const linkSchema = z.string().url();
									const linkErrors = links.map((link) =>
										linkSchema.safeParse(link)
									);
									const invalidZodLinks = linkErrors.filter(
										(error) => !error.success
									);

									// Continue validation even if there are invalid URLs
									const zodErrorMessage = formatLinkErrors(
										links,
										invalidZodLinks,
										(item) => linkErrors.indexOf(item),
										t("invalidLinks")
									);

									// Only check server validation if all links are valid URLs
									if (
										invalidZodLinks.length === 0 ||
										invalidZodLinks.length < links.length
									) {
										// Get valid URLs to check against server
										const validUrls = links.filter(
											(_, index) =>
												linkErrors[index].success
										);

										const validity = await areLinksValid(
											validUrls
										);

										// Group errors by type: invalid URLs vs non-existing resources
										const invalidUrls = validity.filter(
											(v) => v.status === "rejected"
										);
										const nonExistingResources =
											validity.filter(
												(v) =>
													v.status === "fulfilled" &&
													v.value === false
											);

										const invalidUrlsMessage =
											formatLinkErrors(
												validUrls,
												invalidUrls,
												(item) =>
													validity.indexOf(item),
												t("invalidLinks")
											);

										const nonExistingResourcesMessage =
											formatLinkErrors(
												validUrls,
												nonExistingResources,
												(item) =>
													validity.indexOf(item),
												t("resourceNotFound")
											);

										// Check if all links are valid (both format and existence)
										const allUrlsValid =
											invalidZodLinks.length === 0 &&
											invalidUrls.length === 0 &&
											nonExistingResources.length === 0;

										if (allUrlsValid) {
											return; // All links are valid, return success
										}

										// Combine error messages
										const errorMessages: string[] = [];
										if (zodErrorMessage)
											errorMessages.push(zodErrorMessage);
										if (invalidUrlsMessage)
											errorMessages.push(
												invalidUrlsMessage
											);
										if (nonExistingResourcesMessage)
											errorMessages.push(
												nonExistingResourcesMessage
											);

										return errorMessages.join("\n");
									}

									// If all links are invalid URLs, just return the Zod error
									if (zodErrorMessage) {
										return zodErrorMessage;
									}
								},
							}}
						>
							{(field) => (
								<TextareaField
									startContent={
										<BiLink className="text-accent/80" />
									}
									label={t("linksPerLine")}
									field={field}
								/>
							)}
						</form.Field>
					)}
					{fieldsMap.description && (
						<form.Field
							name="description"
							validators={{
								onSubmit: ({ value }) => {
									if (value.length < 20) {
										return t("descriptionMin20");
									}
								},
							}}
						>
							{(field) => (
								<TextareaField
									startContent={
										<BiMessageSquare className="text-accent/80" />
									}
									label={t("description")}
									field={field}
								/>
							)}
						</form.Field>
					)}
				</div>

				<form.Subscribe
					selector={(state) => [state.canSubmit, state.isSubmitting]}
				>
					{([canSubmit, isSubmitting]) => (
						<Button
							color="accent"
							size="lg"
							className="mt-4 w-full max-w-xs font-semibold"
							endContent={
								isSubmitting ? (
									<Spinner size="sm" />
								) : (
									<BiSolidSend className="text-lg" />
								)
							}
							type="submit"
							isDisabled={!canSubmit}
						>
							{isSubmitting ? t("sending") : t("submit")}
						</Button>
					)}
				</form.Subscribe>
			</form>

			{footer}
		</Card>
	);
}