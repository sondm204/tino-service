type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'Tino Expense <noreply@tino.local>';

  if (!apiKey) {
    console.warn(
      `Email is not configured. Skipping email to ${input.to}: ${input.subject}`
    );
    return { sent: false, skipped: true };
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    console.warn(
      `Email send failed with HTTP ${response.status}: ${message || response.statusText}`
    );
    return { sent: false, skipped: false };
  }

  return { sent: true, skipped: false };
}
