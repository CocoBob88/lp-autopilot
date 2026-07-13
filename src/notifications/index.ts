import nodemailer from "nodemailer";

export type Notification = {
  title: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  evidence?: unknown;
};

async function postJson(url: string, body: unknown, headers?: HeadersInit) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok)
    throw new Error(`Notification endpoint returned ${response.status}`);
}

export async function deliverNotification(notification: Notification) {
  const attempts: Array<Promise<void>> = [];
  if (process.env.ALERT_WEBHOOK_URL)
    attempts.push(postJson(process.env.ALERT_WEBHOOK_URL, notification));
  if (process.env.DISCORD_WEBHOOK_URL)
    attempts.push(
      postJson(process.env.DISCORD_WEBHOOK_URL, {
        content: `**${notification.title}**\n${notification.message}`,
      }),
    );
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
    attempts.push(
      postJson(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          chat_id: process.env.TELEGRAM_CHAT_ID,
          text: `${notification.title}\n${notification.message}`,
        },
      ),
    );
  if (
    process.env.SMTP_URL &&
    process.env.ALERT_EMAIL_FROM &&
    process.env.ALERT_EMAIL_TO
  ) {
    attempts.push(
      nodemailer
        .createTransport(process.env.SMTP_URL)
        .sendMail({
          from: process.env.ALERT_EMAIL_FROM,
          to: process.env.ALERT_EMAIL_TO,
          subject: `[${notification.severity}] ${notification.title}`,
          text: notification.message,
        })
        .then(() => undefined),
    );
  }
  const results = await Promise.allSettled(attempts);
  return results.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ adapter: index, error: String(result.reason).slice(0, 200) }]
      : [],
  );
}
