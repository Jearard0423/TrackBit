# TrackBit

TrackBit is a personal behavior-learning app built around **Yesterday → Today → Tomorrow**. Each Bit has a planned amount and an actual amount; users can record what got in the way and carry useful patterns into a more realistic plan. Sleep logs show a rolling 14-day chart, and the Yesterday view can browse earlier dates for reflection.

## Stack

- HTML, CSS, and browser JavaScript modules
- PHP 8.2+ for the web server and authenticated insight endpoint
- Firebase Authentication and Realtime Database
- Firebase Cloud Functions for scheduled task reminder emails
- Resend for email delivery to the user's account email
- Google Gemini API for optional, user-requested progress analysis through PHP

## Firebase setup

1. Create a Firebase project and register a Web app.
2. Enable **Authentication → Email/Password** and **Authentication → Google**, add your development/production hostnames under **Authentication → Settings → Authorized domains**, and create a Realtime Database.
3. Copy the Web app configuration into `src/firebase-config.js`. The web API key is public; RTDB rules protect each user's data.
4. In Realtime Database Rules, publish the contents of `database.rules.json`.
5. Configure `FIREBASE_DATABASE_URL` and `GEMINI_API_KEY` in the PHP server environment. Keep the Gemini key server-side and out of browser JavaScript.

## Run locally

Copy `.env.example` to `.env`, then put the rotated Gemini API key in `.env`. `.env` is ignored by Git and is loaded by the development router; `.env.example` contains placeholders only.

```bash
cp .env.example .env
php -S 127.0.0.1:8000 router.php
```

Open <http://127.0.0.1:8000>. The Tomorrow tab asks before sending the last seven days of Bits, tasks, and sleep entries to Gemini. Without the server-side environment values, tracking still works and analysis displays a setup message.

## Data and privacy

All records are private to `users/{uid}`. Bits and tasks use push IDs so repeated actions on the same date remain distinct; sleep uses the date as its key.

```text
users/{uid}/
	bits/{pushId}: { date, title, unit, plannedAmount, actualAmount, reason, reflection, createdAt, updatedAt }
	tasks/{pushId}: { date, title, completed, dueAt?, dueTimeZone?, reminderSentAt?, createdAt, completedAt }
	sleep/{YYYY-MM-DD}: { date, hours, targetHours, quality, updatedAt }
```

`date` uses local `YYYY-MM-DD`. `actualAmount`, `hours`, and `quality` are optional until recorded; `targetHours` is for a future sleep plan. `database.rules.json` restricts access to the signed-in owner and indexes Bits/tasks by date. The PHP insight endpoint uses the user's Firebase ID token to query only that user's recent records before sending a bounded summary to Gemini. Analysis is sent only after the user clicks the button.

## Task reminder emails

When adding a task, optionally set its email reminder date and time. Reminders are sent only if the task is still incomplete when it is due. Delivery runs in a scheduled Firebase Cloud Function every minute, so it does not depend on a Codespace or a browser tab staying open. Emails are sent through Resend to the user's Firebase account email; they do not come from the user's personal Gmail address.

Scheduled Cloud Functions require the Firebase **Blaze** plan and use Cloud Scheduler. To enable delivery:

1. Create a Resend account and verify a sending domain. Use an address on that verified domain as the sender.
2. Install and authenticate the Firebase CLI, select the Firebase project used by `src/firebase-config.js`, and set the secrets:

   ```bash
   npm install -g firebase-tools
   firebase login
   firebase use --add
   firebase functions:secrets:set RESEND_API_KEY
   firebase functions:secrets:set RESEND_FROM_EMAIL
   ```

   Enter the Resend API key for the first prompt and a sender such as `TrackBit Reminders <reminders@example.com>` for the second. Keep both values private.
3. Install the Functions dependencies and deploy the scheduled functions and database rules:

   ```bash
   npm --prefix functions install
   firebase deploy --only functions,database
   ```

   Run deployment from the repository root with the correct Firebase project selected (or pass `--project <project-id>`).
4. Add a task with a due time in the future and leave it incomplete. The reminder should arrive at the account email around its due time (the scheduler checks every minute).

Tasks without a due time do not send email. Firebase billing and Resend usage limits may apply. To disable a reminder, delete the task or mark it complete before its due time.

## Deployment

Deploy the project on a PHP 8.2+ host with HTTPS. Configure `FIREBASE_DATABASE_URL` and `GEMINI_API_KEY` as server environment values and deny web access to dotfiles. Firebase Hosting alone cannot execute PHP.
