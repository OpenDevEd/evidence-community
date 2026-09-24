"use client";

import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Link02Icon, Mail01Icon, Message01Icon, SentIcon } from "@hugeicons/core-free-icons";
import { AnyFieldApi, useForm } from "@tanstack/react-form";
import { Input } from "@/components/nextui/Input";
import { Card } from "@/components/nextui/Card";
import { Button } from "@/components/nextui/Button";
import { Textarea } from "@/components/nextui/Textarea";
import { useModalError } from "@/hooks/useModalError";
import { AnimatePresence, motion } from "framer-motion";
import { areLinksValid } from "@/lib/actions";
import { Spinner } from "@nextui-org/react";
import { parseRequestLinks } from "@/lib/utils";
import { contactRequestSchema, takedownRequestSchema } from "@/lib/request-validation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

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
		return `${errorType}\n${invalidLinks
			.map((v) => `${v.url} (${v.index})`)
			.join("\n")}`;
	}

	return null;
}

function FieldInfo({ field }: { field: AnyFieldApi }) {
	"use no memo";
	const t = useTranslations("ui");

	const { ErrorField } = useModalError({
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
				type="email"
				autoComplete="email"
				id={field.name}
				isRequired
				validationBehavior="aria"
				name={field.name}
				onBlur={() => {
					field.handleBlur();
					void field.validate("change");
				}}
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
				isRequired
				validationBehavior="aria"
				isInvalid={
					field.state.meta.isTouched &&
					field.state.meta.errors.length > 0
				}
				name={field.name}
				onBlur={() => {
					field.handleBlur();
					void field.validate("change");
				}}
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
};

export default function EmailForm({ fields, header, subtitle, footer, onSubmit }: { fields: (keyof typeof defaultValues)[], header?: string, subtitle?: string, footer?: React.ReactNode, onSubmit: (value: typeof defaultValues, reset: () => void) => Promise<void> }) {
	"use no memo";
	const t = useTranslations("ui");

	const fieldsMap = useMemo(() => {
		return fields.reduce((acc, field) => {
			acc[field] = true;
			return acc;
		}, {} as Record<string, boolean>);
	}, [fields]);

	const requestSchema = fieldsMap.links ? takedownRequestSchema : contactRequestSchema;
	const validateEmail = ({ value }: { value: string }) =>
		contactRequestSchema.shape.email.safeParse(value).success
			? undefined
			: t("invalidEmail");
	const validateDescription = ({ value }: { value: string }) =>
		contactRequestSchema.shape.description.safeParse(value).success
			? undefined
			: t("descriptionMin20");
	const form = useForm({
		defaultValues: {
            email: "",
            links: "",
            description: "",
        },
		onSubmit: async ({ value, formApi }) => {
			await onSubmit(value, () => formApi.reset());
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
					<HugeiconsIcon icon={Message01Icon} className="w-12 h-12 text-accent" />
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
								onChange: validateEmail,
							}}
						>
							{(field) => (
								<InputField
									startContent={
										<HugeiconsIcon icon={Mail01Icon} className="text-accent/80" />
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

									const links = parseRequestLinks(value);
									if (links.length === 0) return t("enterLinks");
									// zod link validation
									const linkSchema = takedownRequestSchema.shape.links.element;
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
										<HugeiconsIcon icon={Link02Icon} className="text-accent/80" />
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
								onChange: validateDescription,
							}}
						>
							{(field) => (
								<TextareaField
									startContent={
										<HugeiconsIcon icon={Message01Icon} className="text-accent/80" />
									}
									label={t("description")}
									field={field}
								/>
							)}
						</form.Field>
					)}
				</div>

				<form.Subscribe
					selector={(state) => [
						state.canSubmit && requestSchema.safeParse({
							...state.values,
							links: parseRequestLinks(state.values.links),
						}).success,
						state.isSubmitting,
					]}
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
									<HugeiconsIcon icon={SentIcon} className="text-lg" />
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
