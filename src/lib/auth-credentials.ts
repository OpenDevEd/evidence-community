import { z } from "zod";

export const credentialsSchema = z.object({
	email: z.string().email({
		message: "invalidEmail",
	}),
	password: z.string().min(8, {
		message: "invalidPassword",
	}),
	register: z
		.union([z.boolean(), z.string()])
		.optional()
		.transform((value) => {
			if (typeof value === "boolean") return value;
			return value === "true";
		}),
});

export type CredentialsInput = z.input<typeof credentialsSchema>;
