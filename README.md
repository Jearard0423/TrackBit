# TrackBit

TrackBit is a personal behavior-learning app built around **Yesterday → Today → Tomorrow**. Each Bit has a planned amount and an actual amount; users can record what got in the way and carry useful patterns into a more realistic plan. The Yesterday view connects task completion and Bit outcomes with a private daily diary and an optional AI reflection assistant. Sleep logs show a rolling 14-day chart, and the Yesterday view can browse earlier dates.

## Stack

- HTML, CSS, and browser JavaScript modules
- PHP 8.2+ for the web server and authenticated Gemini endpoints
- Firebase Authentication and Realtime Database
- Firebase Cloud Functions for scheduled task reminder emails
- Resend for email delivery to the user's account email
- Google Gemini API for optional, user-requested progress analysis and reflection assistance through PHP

## Firebase setup

1. Create a Firebase project and register a Web app.
2. Enable **Authentication → Email/Password** and **Authentication → Google**, add your development/production hostnames under **Authentication → Settings → Authorized domains**, and create a Realtime Database.
3. Copy the Web app configuration into `src/firebase-config.js`. The web API key is public; Realtime Database rules restrict each user's data to that user.
4. Publish the Realtime Database rules from `database.rules.json` with `firebase deploy --only database`.
5. Configure `FIREBASE_DATABASE_URL` and `GEMINI_API_KEY` in the PHP server environment. Keep the Gemini key server-side and out of browser JavaScript.

## Run locally

Copy `.env.example` to `.env`, then put the rotated Gemini API key in `.env`. `.env` is ignored by Git and is loaded by the development router; `.env.example` contains placeholders only.

```bash
cp .env.example .env
php -S 127.0.0.1:8000 router.php
```

Open <http://127.0.0.1:8000>. The Tomorrow tab asks before sending the last seven days of Bits, tasks, and sleep entries to Gemini. On the Yesterday tab, the reflection assistant sends the selected day's task and Bit history, the note text in the diary box, and the conversation only when the user submits a question. Diary notes are saved to the user's private Realtime Database account; assistant conversations are not saved by TrackBit. Tasks added while browsing a past date are recorded for that date and do not offer email reminders. Without the server-side environment values, tracking and diary notes still work, while AI features show a setup message.

## Data and privacy

All records are private to `users/{uid}`. Bits and tasks use push IDs so repeated actions on the same date remain distinct; sleep uses the date as its key.

```text
users/{uid}/
	bits/{pushId}: { date, title, unit, plannedAmount, actualAmount, reason, reflection, createdAt, updatedAt }
	tasks/{pushId}: { date, title, completed, status?, dueAt?, dueTimeZone?, reminderSentAt?, createdAt, completedAt }
	sleep/{YYYY-MM-DD}: { date, hours, targetHours, quality, updatedAt }
	reflections/{YYYY-MM-DD}: { note, updatedAt }
	profilePhoto: "data:image/jpeg;base64,..."
```

`date` uses local `YYYY-MM-DD`. `actualAmount`, `hours`, and `quality` are optional until recorded; `targetHours` is for a future sleep plan. The Yesterday dashboard has separate History and Add History tabs. An entry can include a date, title, description, and done, pending, or skipped status. History dates must be real calendar dates no later than today; valid older dates (including dates such as April 23, 1975) are allowed. The Add History form can use the device camera to scan a written note with in-browser English OCR; the user reviews and edits recognized fields before saving. The image is processed in the browser and is not saved or uploaded by TrackBit. The OCR library and English language data are downloaded by the browser on the first scan, and camera access requires browser permission and a secure context (HTTPS or localhost). Skipped tasks are excluded from email reminders. Profile pictures are cropped and compressed in the browser to a small JPEG data URL, then saved under the user's existing Realtime Database record; this avoids requiring Firebase Storage. `database.rules.json` restricts access to the signed-in owner and indexes Bits/tasks by date. Both PHP Gemini endpoints use the user's Firebase ID token to query only that user's records. Weekly analysis is sent only after the user clicks its button. Reflection assistant requests include only the selected day's task and Bit history, diary text currently in the journal, and conversation, and are sent only when the user submits a question.

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
