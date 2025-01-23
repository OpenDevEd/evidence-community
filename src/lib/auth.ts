import { signIn } from "next-auth/react";
import { authorize } from "./actions";

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
		const user = await authorize({ email, password, register });
		if (user) {
			return signIn("credentials", {
				email,
				password,
				register,
				redirect: false,
			});
		}
		return { error: "Invalid credentials" };
	} catch (error: any) {
		return { error: error.message };
	}
}