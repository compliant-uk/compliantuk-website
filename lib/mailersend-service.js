// api/mailersend-service.js
import { MailerSend, EmailParams, Sender, Recipient } from "mailersend";

const mailerSend = new MailerSend({
  apiKey: process.env.MAILERSEND_API_KEY,
});

const sentFrom = new Sender("noreply@compliantuk.co.uk", "CompliantUK");

/**
 * Send a simple email using MailerSend
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email HTML content
 * @param {string} [options.text] - Email plain text content
 * @param {string} [options.fromName] - Custom sender name
 */
export async function sendEmail({ to, subject, html, text, fromName }) {
  const recipients = [new Recipient(to)];
  
  const emailParams = new EmailParams()
    .setFrom(fromName ? new Sender("noreply@compliantuk.co.uk", fromName) : sentFrom)
    .setTo(recipients)
    .setSubject(subject)
    .setHtml(html)
    .setText(text || html.replace(/<[^>]*>?/gm, ''));

  try {
    const response = await mailerSend.email.send(emailParams);
    return response;
  } catch (error) {
    console.error("MailerSend Error:", error);
    throw error;
  }
}
