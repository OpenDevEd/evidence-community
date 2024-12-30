import { signIn } from "next-auth/react";
import Error from "next/error";

export async function authenticate({
	email,
	password,
	register,
}: {
	email: string;
	password: string;
	register: boolean;
}): Promise<{ error: string } | any> {
	try {
		return await signIn("credentials", { email, password, register, redirect: false });
	} catch (error: any) {
		return { error: error.message };
	}
}
