const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase, ServerValue } = require("firebase-admin/database");
const { logger } = require("firebase-functions");
const { defineSecret } = require("firebase-functions/params");
const { onValueWritten } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");

initializeApp();

const resendApiKey = defineSecret("RESEND_API_KEY");
const resendFromEmail = defineSecret("RESEND_FROM_EMAIL");
const reminderClaimDurationMs = 5 * 60 * 1000;
const maxRemindersPerRun = 100;

function reminderIndexKey(uid, taskId) {
  return `${uid}_${taskId}`;
}

function isReminderEligible(task) {
  return task
    && task.completed !== true
    && task.status !== "skipped"
    && !task.reminderSentAt
    && !task.reminderSkippedAt
    && Number.isFinite(task.dueAt)
    && task.dueAt > 0;
}

exports.indexTaskReminder = onValueWritten(
  "/users/{uid}/tasks/{taskId}",
  async event => {
    const { uid, taskId } = event.params;
    const indexRef = getDatabase().ref(`taskReminders/${reminderIndexKey(uid, taskId)}`);
    const taskSnapshot = await getDatabase().ref(`users/${uid}/tasks/${taskId}`).get();
    const task = taskSnapshot.val();

    if (!isReminderEligible(task)) {
      await indexRef.remove();
      return;
    }

    await indexRef.set({ uid, taskId, title: task.title, dueAt: task.dueAt });
  },
);

exports.sendDueTaskReminders = onSchedule(
  {
    schedule: "every 1 minutes",
    timeZone: "UTC",
    maxInstances: 1,
    timeoutSeconds: 120,
    secrets: [resendApiKey, resendFromEmail],
  },
  async () => {
    const now = Date.now();
    const dueSnapshot = await getDatabase()
      .ref("taskReminders")
      .orderByChild("dueAt")
      .endAt(now)
      .limitToFirst(maxRemindersPerRun)
      .get();
    const reminders = Object.entries(dueSnapshot.val() || {});

    await Promise.all(reminders.map(([key, reminder]) => sendReminder(key, reminder, now)));
  },
);

async function sendReminder(indexKey, reminder, now) {
  const { uid, taskId } = reminder;
  const taskRef = getDatabase().ref(`users/${uid}/tasks/${taskId}`);
  const claim = await taskRef.transaction(task => {
    if (!isReminderEligible(task) || task.dueAt > now) return;

    const claimedAt = Number(task.reminderClaimedAt);
    if (claimedAt && now - claimedAt < reminderClaimDurationMs) return;

    return { ...task, reminderClaimedAt: now };
  });

  if (!claim.committed) return;

  try {
    const task = claim.snapshot.val();
    const user = await getAuth().getUser(uid);
    if (!user.email) {
      await taskRef.update({
        reminderSkippedAt: ServerValue.TIMESTAMP,
        reminderClaimedAt: null,
      });
      await getDatabase().ref(`taskReminders/${indexKey}`).remove();
      logger.warn("Skipping task reminder because the account has no email address.", { uid, taskId });
      return;
    }

    const dueTime = formatDueTime(task.dueAt, task.dueTimeZone);
    const title = String(task.title || "Your task");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey.value()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `trackbit-task-${uid}-${taskId}`,
      },
      body: JSON.stringify({
        from: resendFromEmail.value(),
        to: [user.email],
        subject: `TrackBit reminder: ${title}`,
        text: `Your task "${title}" is due now (${dueTime}). Open TrackBit to update your progress.`,
        html: `<p>Your task <strong>${escapeHtml(title)}</strong> is due now (${escapeHtml(dueTime)}).</p><p>Open TrackBit to update your progress.</p>`,
      }),
    });

    if (!response.ok) {
      throw new Error(`Resend rejected the reminder with HTTP ${response.status}.`);
    }

    await taskRef.update({
      reminderSentAt: ServerValue.TIMESTAMP,
      reminderClaimedAt: null,
    });
    await getDatabase().ref(`taskReminders/${indexKey}`).remove();
    logger.info("Sent task reminder email.", { uid, taskId });
  } catch (error) {
    try {
      await taskRef.transaction(task => {
        if (!task || Number(task.reminderClaimedAt) !== now) return;
        return { ...task, reminderClaimedAt: null };
      });
    } catch (releaseError) {
      logger.error("Could not release the task reminder claim; it will expire automatically.", {
        uid,
        taskId,
        error: releaseError,
      });
    }
    logger.error("Task reminder email failed; it will be retried.", { uid, taskId, error });
  }
}

function formatDueTime(timestamp, timeZone) {
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timeZone || "UTC",
    }).format(new Date(timestamp));
  } catch (error) {
    logger.warn("Invalid task time zone; reminder will use UTC.", { timeZone, error });
    return new Intl.DateTimeFormat("en", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date(timestamp));
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
