import type { MailMessage, MailProvider } from "./provider";

type ForwardEmailConfig = {
  apiToken: string;
  from: string;
};

export function createForwardEmailProvider(
  config: ForwardEmailConfig,
): MailProvider {
  return {
    async send(message: MailMessage): Promise<void> {
      const body = new URLSearchParams({
        from: config.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });

      if (message.html) body.set("html", message.html);

      const response = await fetch("https://api.forwardemail.net/v1/emails", {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${config.apiToken}:`)}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `forward_email_send_failed:${response.status}:${detail.slice(0, 500)}`,
        );
      }
    },
  };
}
