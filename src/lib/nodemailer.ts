import nodemailer from "nodemailer";

const requiredEnvVars = ['EMAIL_HOST', 'EMAIL_PORT', 'EMAIL_USER', 'EMAIL_PASS'] as const;

const hasAllEnvVars = requiredEnvVars.every(envVar => !!process.env[envVar]);

const transporter = hasAllEnvVars 
    ? nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: parseInt(process.env.EMAIL_PORT || "587"),
        secure: false,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    })
    : null;

export default transporter;