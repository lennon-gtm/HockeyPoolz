/**
 * list-alpha-users.mjs
 * Lists all Firebase Auth users for the HockeyPoolz project.
 * Used by the signyl-alpha-loop skill to pull the alpha tester list.
 *
 * Usage: node scripts/list-alpha-users.mjs
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local manually (Next.js env files aren't auto-loaded by node)
const envPath = resolve(__dirname, '../.env.local');
const envLines = readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const val = match[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    process.env[key] = val;
  }
}

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
const result = await auth.listUsers(1000);

const users = result.users
  .filter(u => u.email) // skip anonymous users
  .map(u => ({
    name: u.displayName || u.email.split('@')[0],
    email: u.email,
    uid: u.uid,
    created: u.metadata.creationTime,
  }));

console.log(JSON.stringify(users, null, 2));
