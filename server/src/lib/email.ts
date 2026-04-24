import axios from "axios";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const username = process.env.ENGAGE_LAB_USERNAME;
  const apiKey = process.env.ENGAGE_LAB_API_KEY;
  const fromEmail = process.env.ENGAGE_LAB_FROM_EMAIL;

  if (!username || !apiKey || !fromEmail) {
    throw new Error(
      "EngageLab email configuration is incomplete. Please set ENGAGE_LAB_USERNAME, ENGAGE_LAB_API_KEY, and ENGAGE_LAB_FROM_EMAIL.",
    );
  }

  const authString = Buffer.from(`${username}:${apiKey}`).toString("base64");

  await axios.post(
    "https://email.api.engagelab.cc/v1/mail/send",
    {
      from: fromEmail,
      to: [payload.to],
      body: {
        subject: payload.subject,
        content: {
          html:
            payload.html +
            `<p style='font-size:12px;opacity:0;pointer-events: none;position: absolute;left: 0;top: 0;'><a href='%%user_defined_unsubscribe_link%%'>&nbsp;</a></p>`,
        },
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${authString}`,
      },
      timeout: 15000,
    },
  );
}
