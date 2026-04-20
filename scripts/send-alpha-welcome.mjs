/**
 * send-alpha-welcome.mjs
 * Sends the Day 0 alpha welcome email to the HockeyPoolz tester roster.
 *
 * Requires GMAIL_APP_PASSWORD in .env.local (Google App Password for lennon@signyl.gg).
 *
 * Usage:
 *   node scripts/send-alpha-welcome.mjs            # dry-run (prints what it would send)
 *   node scripts/send-alpha-welcome.mjs --send     # actually sends
 *   node scripts/send-alpha-welcome.mjs --send --only=email@x.com   # single recipient test
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
const envPath = resolve(__dirname, '../.env.local');
for (const line of readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) {
    const key = m[1].trim();
    const val = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    process.env[key] = val;
  }
}

const args = process.argv.slice(2);
const DO_SEND = args.includes('--send');
const onlyArg = args.find(a => a.startsWith('--only='));
const onlyEmail = onlyArg ? onlyArg.split('=')[1].toLowerCase() : null;

const SENDER_NAME = 'Lennon';
const SENDER_EMAIL = 'lennon@signyl.gg';
const PROJECT_NAME = 'HockeyPoolz';
const PROJECT_URL = 'https://hockey-poolz.vercel.app';
const SUBJECT = "You're in — wanted to tell you a bit about what we're up to";
const CTA_LABEL = `Open ${PROJECT_NAME}`;

// Dedupe + name overrides per user's instructions
const SKIP_EMAILS = new Set([
  'lennon.inc@gmail.com',      // keep lennon@signyl.gg instead
  'matthew.caluori7@gmail.com', // keep caluorimatthew@gmail.com instead
]);

const NAME_OVERRIDES = {
  'anthonydire@yahoo.ca': 'Anthony',
  'aesposito@terracan.ca': 'Al',
};

function firstName(raw, email) {
  const override = NAME_OVERRIDES[email.toLowerCase()];
  if (override) return override;
  if (!raw) return email.split('@')[0];
  const first = raw.trim().split(/\s+/)[0];
  // If display name looks like an email local-part or is clearly not a name
  if (!first || first.includes('@')) return email.split('@')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

const BODY_HTML = (firstName) => `
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  Thanks for connecting to ${PROJECT_NAME} — I hope you enjoy the experience of a personalized hockey pool.
</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  I wanted to share a bit about where this is all going.
</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  We're in the early days of what I genuinely believe will change how creators connect with the fans who care about what they make — not through ads &amp; follower counts, but through real identity. The kind where fans decide what they share and who sees it.
</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  Where as makers, we value reaching the right people with authenticity and products made for them rather than reaching more people generically. Signyl is what I'm building to make that real.
</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  ${PROJECT_NAME} is an alpha test and one of the first things I'm putting in people's hands. It's live, it's real, and you're an important early cohort on this journey. Thanks for your patience as we work out some of the pixie dust.
</p>
<p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3d2a10;">
  That means a lot. Honestly.
</p>
<p style="margin:0 0 0;font-size:16px;line-height:1.6;color:#3d2a10;">
  I'll check in in a few days to hear how it's going. And around day 7 I'll send a short survey — 10 questions, your answers go straight into what we build next.
</p>
`;

const CLOSING = 'Thanks for being here at the beginning.';

// Load + populate template
const TEMPLATE = readFileSync(
  resolve(__dirname, '../../Signyl/skills/signyl-alpha-loop/assets/email-template.html'),
  'utf8'
);

function renderEmail(firstName) {
  return TEMPLATE
    .replaceAll('{{SUBJECT}}', SUBJECT)
    .replaceAll('{{PROJECT_NAME}}', PROJECT_NAME)
    .replaceAll('{{FIRST_NAME}}', firstName)
    .replaceAll('{{BODY_CONTENT}}', BODY_HTML(firstName))
    .replaceAll('{{PRIMARY_CTA_URL}}', PROJECT_URL)
    .replaceAll('{{PRIMARY_CTA_LABEL}}', CTA_LABEL + ' →')
    .replaceAll('{{CLOSING}}', CLOSING)
    .replaceAll('{{SENDER_NAME}}', SENDER_NAME)
    .replaceAll('{{UNSUBSCRIBE_URL}}', `mailto:${SENDER_EMAIL}?subject=Unsubscribe`);
}

// Pull the tester list (same logic as list-alpha-users.mjs)
const { default: admin } = await import('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const auth = admin.auth();
const { users } = await auth.listUsers(1000);

const roster = users
  .filter(u => u.email && !SKIP_EMAILS.has(u.email.toLowerCase()))
  .map(u => ({
    email: u.email,
    firstName: firstName(u.displayName, u.email),
    displayName: u.displayName || '',
  }));

const finalList = onlyEmail
  ? roster.filter(r => r.email.toLowerCase() === onlyEmail)
  : roster;

console.log(`\n${DO_SEND ? 'SENDING' : 'DRY RUN — would send'} to ${finalList.length} recipient(s):\n`);
for (const r of finalList) {
  console.log(`  → ${r.firstName.padEnd(12)}  ${r.email}  ${r.displayName ? `(${r.displayName})` : ''}`);
}

if (!DO_SEND) {
  console.log('\nRe-run with --send to actually send.\n');
  process.exit(0);
}

const appPassword = process.env.GMAIL_APP_PASSWORD;
if (!appPassword) {
  console.error('\nERROR: GMAIL_APP_PASSWORD not set in .env.local');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: SENDER_EMAIL, pass: appPassword },
  tls: { rejectUnauthorized: false },
});

console.log('\nVerifying SMTP connection...');
await transporter.verify();
console.log('SMTP ready.\n');

let sent = 0;
let failed = 0;
for (const r of finalList) {
  try {
    const html = renderEmail(r.firstName);
    const info = await transporter.sendMail({
      from: `"${SENDER_NAME}" <${SENDER_EMAIL}>`,
      to: r.email,
      subject: SUBJECT,
      html,
    });
    sent++;
    console.log(`  ✓ ${r.firstName.padEnd(12)}  ${r.email}   ${info.messageId}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${r.firstName.padEnd(12)}  ${r.email}   ${err.message}`);
  }
}

console.log(`\nDone. Sent: ${sent}   Failed: ${failed}\n`);
process.exit(failed > 0 ? 1 : 0);
