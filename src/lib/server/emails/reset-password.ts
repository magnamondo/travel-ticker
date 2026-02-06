import { sendEmail } from '$lib/server/email';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from '$lib/server/db/schema';

type Database = BaseSQLiteDatabase<'async', unknown, typeof schema>;

export interface ResetPasswordEmailData {
	email: string;
	resetToken: string;
	userId?: string;
}

export async function sendResetPasswordEmail(data: ResetPasswordEmailData, origin: string, db?: Database) {
	const logoUrl = `${origin}/logo.jpg`;
	const resetLink = `${origin}/reset-password?token=${data.resetToken}`;

	const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Reset Password</title>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; color: #000000; font-family: system-ui, -apple-system, sans-serif;">
	<!-- Wrapper table for full-width background -->
	<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #ffffff; min-height: 100vh;">
		<tr>
			<td align="center" style="padding: 40px 20px;">
				<!-- Main card -->
				<div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 40px; text-align: center;">
					<div style="margin-bottom: 30px;">
						<a href="${origin}" style="text-decoration: none; display: inline-block;">
							<img src="${logoUrl}" alt="Magnamondo" width="180" style="display: block; width: 180px; height: auto;" />
						</a>
					</div>
					
					<h1 style="color: #000000; margin: 0 0 20px; font-size: 24px;">Reset your password</h1>
					
					<p style="color: #333333; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
						We received a request to reset your password. Click the button below to choose a new password.
					</p>
					
					<div style="margin-bottom: 30px;">
						<a href="${resetLink}" style="background-color: #000000; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 4px; font-weight: 600; display: inline-block; font-size: 16px; transition: opacity 0.2s;">
							Reset Password
						</a>
					</div>
					
					<p style="color: #666666; font-size: 13px; margin: 0;">
						This link expires in 2 hours. If you didn't request a password reset, you can safely ignore this email.
					</p>
					
					<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666666; font-size: 12px;">
						<p style="margin: 0;">&copy; ${new Date().getFullYear()} Magnamondo</p>
					</div>
				</div>
			</td>
		</tr>
	</table>
</body>
</html>`;

	return sendEmail(
		{
			to: data.email,
			subject: 'Reset your password - Magnamondo',
			html
		},

	);
}
