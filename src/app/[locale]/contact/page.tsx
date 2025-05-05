import ContactComponent from "@/components/pages/Contact";
import transporter from "@/lib/nodemailer";
import { notFound } from "next/navigation";

export default function Contact() {

	if (!transporter || !process.env.CONTACT_EMAIL) {
		return notFound();
	}

	return <ContactComponent />;
}   