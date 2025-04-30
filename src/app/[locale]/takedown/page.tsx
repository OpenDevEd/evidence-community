import Takedown from "@/components/pages/Takedown";
import transporter from "@/lib/nodemailer";
import { notFound } from "next/navigation";

export default function Page() {

	if (!transporter) {
		return notFound();
	}
	
	return <Takedown />
}
