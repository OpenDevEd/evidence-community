import Takedown from "@/components/pages/Takedown";
import transporter from "@/lib/nodemailer";
import { notFound } from "next/navigation";

export default function Page() {

	if (!transporter || !process.env.TAKEDOWN_EMAIL) {
		return notFound();
	}
	
	return <Takedown />
}
