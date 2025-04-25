"use client";

import PageContainer from "../layout/PageContainer";
import { AnyFieldApi, useForm } from "@tanstack/react-form";
import { z, ZodError } from "zod";
import { Input } from "../nextui/Input";
import { Card } from "../nextui/Card";
import { Button } from "../nextui/Button";
import { Textarea } from "../nextui/Textarea";
import { useModalError } from "@/hooks/useModalError";
import { AnimatePresence, motion } from "framer-motion";
import { BiLink, BiMessageSquare, BiSolidSend, BiUser } from "react-icons/bi";
import { areLinksValid, sendTakedownRequest } from "@/lib/actions";
import { Spinner } from "@nextui-org/react";
import { toast } from "@/components/layout/Toast";
import { takedownRequestSchema } from "@/lib/utils";
import { MdEmail } from "react-icons/md";

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
		return `${errorType} link(s):\n${LINK_SEPARATOR}${invalidLinks
			.map((v) => `${v.url} (line ${v.index})`)
			.join(`\n${LINK_SEPARATOR}`)}`;
	}

	return null;
}

function FieldInfo({ field }: { field: AnyFieldApi }) {
	"use no memo";

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
									<p className="text-sm">Validating...</p>
								</Card>
							</motion.div>
						) : null}
					</AnimatePresence>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}

function InputField({ label, field, startContent }: { label: string; field: AnyFieldApi; startContent?: React.ReactNode }) {
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

export default function Takedown() {
	"use no memo";

	const form = useForm({
		defaultValues: {
			email: "",
			links: "",
			description: "",
		},
		onSubmit: async ({ value }) => {
			console.log("got takedown request", value);
			const result = await sendTakedownRequest(
				value.email,
				value.links.split("\n").filter(Boolean),
				value.description
			);
			if (result.success) {
				toast({
					title: "Takedown request sent",
					description:
						"We will review your request and get back to you as soon as possible.",
					type: "success",
				});
			} else {
				toast({
					title: "Failed to send takedown request",
					description: "Please try again later.",
					type: "error",
				});
			}
		},
	});

	return (
		<PageContainer id="main-content" className="flex gap-4 items-start">
			<Card
				color="card"
				className="w-full p-16 flex items-center justify-center"
			>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						void form.handleSubmit();
					}}
					className="w-full max-w-2xl flex flex-col gap-4 items-center"
				>
					<h1 className="text-2xl font-bold">Takedown Request</h1>
					<form.Field
						name="email"
						validators={{
							onChange: z.string().email(),
						}}
						children={(field) => (
							<InputField
								startContent={<MdEmail />}
								label="Email"
								field={field}
							/>
						)}
					/>
					<form.Field
						name="links"
						validators={{
							onChangeAsyncDebounceMs: 500,
							onChangeAsync: async ({ value }) => {
								if (!value) {
									return "Please enter links";
								}

								const links = value.split("\n").filter(Boolean);
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
									(item) => linkErrors.indexOf(item)
								);

								// Only check server validation if all links are valid URLs
								if (
									invalidZodLinks.length === 0 ||
									invalidZodLinks.length < links.length
								) {
									// Get valid URLs to check against server
									const validUrls = links.filter(
										(_, index) => linkErrors[index].success
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

									const invalidUrlsMessage = formatLinkErrors(
										validUrls,
										invalidUrls,
										(item) => validity.indexOf(item),
										"Invalid"
									);

									const nonExistingResourcesMessage =
										formatLinkErrors(
											validUrls,
											nonExistingResources,
											(item) => validity.indexOf(item),
											"Resource doesn't exist"
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
										errorMessages.push(invalidUrlsMessage);
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
						children={(field) => (
							<TextareaField
								startContent={<BiLink />}
								label="Links (one per line)"
								field={field}
							/>
						)}
					/>
					<form.Field
						name="description"
						validators={{
							onSubmit: takedownRequestSchema.shape.description,
						}}
						children={(field) => (
							<TextareaField
								startContent={<BiMessageSquare />}
								label="Description (min 20 characters)"
								field={field}
							/>
						)}
					/>
					<form.Subscribe
						selector={(state) => [
							state.canSubmit,
							state.isSubmitting,
						]}
						children={([canSubmit, isSubmitting]) => (
							<Button
								color="accent"
								endContent={<BiSolidSend />}
								type="submit"
								isDisabled={!canSubmit}
							>
								{isSubmitting ? "Sending..." : "Submit"}
							</Button>
						)}
					/>
				</form>
			</Card>
		</PageContainer>
	);
}
