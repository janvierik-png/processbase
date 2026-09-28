import { EmailStatus } from '../generated/prisma/client';
import { prisma } from './prisma';

/**
 * Odchadzajuce emaily (#20).
 *
 * Zatial je jediny sposob dorucenia fronta v databaze (EmailOutbox). Skutocne
 * odoslanie cez poskytovatela (SMTP alebo API) sa doplni, az bude znamy
 * poskytovatel, odosielacia domena a DNS zaznamy (SPF, DKIM, DMARC) — potom sa
 * emaily z fronty odoslu a ich telo sa zmaze (obsahuje jednorazove odkazy).
 */
export const APP_URL = (process.env['APP_URL'] ?? 'http://localhost:4200').replace(/\/$/, '');
export const MAIL_TRANSPORT = process.env['MAIL_TRANSPORT'] ?? 'outbox';

export type EmailTemplate = 'email-verify' | 'password-reset';

type TemplateData = { name: string; link: string };

const TEMPLATES: Record<EmailTemplate, (data: TemplateData) => { subject: string; text: string }> = {
  'email-verify': ({ name, link }) => ({
    subject: 'Potvrďte svoj e-mail v Processbase',
    text: [
      `Dobrý deň, ${name},`,
      '',
      'potvrďte, prosím, svoju e-mailovú adresu:',
      link,
      '',
      'Odkaz platí 48 hodín. Ak ste si účet nezakladali, správu môžete ignorovať.',
      '',
      'Processbase'
    ].join('\n')
  }),
  'password-reset': ({ name, link }) => ({
    subject: 'Obnovenie hesla v Processbase',
    text: [
      `Dobrý deň, ${name},`,
      '',
      'dostali sme žiadosť o obnovenie hesla k vášmu účtu. Nové heslo nastavíte tu:',
      link,
      '',
      'Odkaz platí 1 hodinu a dá sa použiť iba raz. Ak ste o obnovenie nežiadali,',
      'správu ignorujte — vaše heslo zostáva nezmenené.',
      '',
      'Processbase'
    ].join('\n')
  })
};

export async function queueEmail(to: string, template: EmailTemplate, data: TemplateData): Promise<void> {
  const { subject, text } = TEMPLATES[template](data);
  await prisma.emailOutbox.create({ data: { toAddress: to, template, subject, bodyText: text } });
}

/** Stav dorucovania pre backoffice (#18) — len pocty, nie adresy ani obsah. */
export async function emailDeliveryStats() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [queued, sentLastDay, failedLastDay] = await Promise.all([
    prisma.emailOutbox.count({ where: { status: EmailStatus.QUEUED } }),
    prisma.emailOutbox.count({ where: { status: EmailStatus.SENT, sentAt: { gte: since } } }),
    prisma.emailOutbox.count({ where: { status: EmailStatus.FAILED, createdAt: { gte: since } } })
  ]);
  const configured = MAIL_TRANSPORT !== 'outbox';
  return {
    configured,
    transport: MAIL_TRANSPORT,
    queued,
    sentLastDay,
    failedLastDay,
    note: configured
      ? `Odosielanie cez ${MAIL_TRANSPORT}.`
      : `Poskytovateľ e-mailov nie je nastavený — ${queued} e-mailov čaká vo fronte (#20).`
  };
}
