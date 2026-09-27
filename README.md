# TrackBit

TrackBit is a personal behavior-learning app built around **Yesterday → Today → Tomorrow**. Each Bit has a planned amount and an actual amount; users can record what got in the way and carry useful patterns into a more realistic plan.

## Stack

- HTML, CSS, and browser JavaScript modules
- PHP 8.2+ for the web server and authenticated insight endpoint
- Firebase Authentication and Realtime Database
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
	tasks/{pushId}: { date, title, completed, createdAt, completedAt }
	sleep/{YYYY-MM-DD}: { date, hours, targetHours, quality, updatedAt }
```

`date` uses local `YYYY-MM-DD`. `actualAmount`, `hours`, and `quality` are optional until recorded; `targetHours` is for a future sleep plan. `database.rules.json` restricts access to the signed-in owner and indexes Bits/tasks by date. The PHP insight endpoint uses the user's Firebase ID token to query only that user's recent records before sending a bounded summary to Gemini. Analysis is sent only after the user clicks the button.

## Deployment

Deploy the project on a PHP 8.2+ host with HTTPS. Configure `FIREBASE_DATABASE_URL` and `GEMINI_API_KEY` as server environment values and deny web access to dotfiles. Firebase Hosting alone cannot execute PHP.

