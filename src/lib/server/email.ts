import { Resend } from 'resend';
import { env } from '$env/dynamic/private';
import crypto from 'node:crypto';
import { encodeBase32LowerCase } from '@oslojs/encoding';

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

function generateId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	return encodeBase32LowerCase(bytes);
}

export interface EmailAttachment {
	content: string; // Base64 encoded content
	filename: string;
	contentType?: string;
}

export interface SendEmailOptions {
	to: string;
	subject: string;
	html: string;
	from?: string;
	attachments?: EmailAttachment[];
}

export interface SendEmailResult {
	success: boolean;
	data?: unknown;
	error?: unknown;
	emailLogId?: string;
}

/**
 * Send an email
 */
export async function sendEmail(
	options: SendEmailOptions
): Promise<SendEmailResult> {
	const { to, subject, html, from = 'Magnamondo <system@magnamondo.com>', attachments } = options;
	
	let success = false;
	let data: unknown = undefined;
	let error: unknown = undefined;
	let providerMessageId: string | undefined = undefined;

	if (resend) {
		try {
			const result = await resend.emails.send({
				from,
				to,
				subject,
				html,
				attachments: attachments?.map(att => ({
					content: att.content,
					filename: att.filename,
					contentType: att.contentType
				}))
			});
			success = true;
			data = result;
			providerMessageId = result.data?.id;
		} catch (err) {
			console.error('Failed to send email:', err);
			success = false;
			error = err;
		}
	} else {
		// Mock mode for development
		console.log('--- EMAIL MOCK ---');
		console.log(`From: ${from}`);
		console.log(`To: ${to}`);
		console.log(`Subject: ${subject}`);
		
		// Extract and display any verification/reset links for easy local testing
		const linkMatch = html.match(/href="(https?:\/\/[^"]*(?:verify-email|reset-password)[^"]*)"/);
		if (linkMatch) {
			console.log(`\n🔗 Action Link: ${linkMatch[1]}\n`);
		}
		
		console.log('Body:', html.substring(0, 200) + '...');
		if (attachments?.length) {
			console.log(`Attachments: ${attachments.map(a => a.filename).join(', ')}`);
		}
		console.log('------------------');
		success = true;
		providerMessageId = `mock_${generateId()}`;
	}

	return { success, data, error };
}

