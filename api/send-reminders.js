import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

// Service role key — server-only, bypasses RLS so this can check tasks/subscriptions
// for every user, not just one. Never expose this key to the browser.
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

webpush.setVapidDetails(
  "mailto:no-reply@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  // Basic protection so random people on the internet can't trigger this endpoint.
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Yetkisiz" });
    return;
  }

  const now = new Date();
  const nowStr = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const fiveMinLater = new Date(now.getTime() + 5 * 60 * 1000);
  const laterStr = `${fiveMinLater.getHours().toString().padStart(2, "0")}:${fiveMinLater
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const todayDate = now.toISOString().slice(0, 10);

  // Tasks due today, in the next 5 minutes, not done, not yet notified.
  const { data: dueTasks, error } = await supabaseAdmin
    .from("tasks")
    .select("*")
    .eq("date", todayDate)
    .eq("done", false)
    .eq("notified", false)
    .gte("time", nowStr)
    .lte("time", laterStr);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }
  if (!dueTasks || dueTasks.length === 0) {
    res.status(200).json({ sent: 0 });
    return;
  }

  let sent = 0;
  for (const task of dueTasks) {
    const { data: subs } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", task.user_id);

    for (const sub of subs || []) {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      const payload = JSON.stringify({
        title: "Fiş — hatırlatma",
        body: task.title + (task.time ? ` · saat ${task.time}` : ""),
      });
      try {
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch (e) {
        // Subscription expired/invalid — remove it.
        if (e.statusCode === 410 || e.statusCode === 404) {
          await supabaseAdmin.from("push_subscriptions").delete().eq("id", sub.id);
        }
      }
    }

    await supabaseAdmin.from("tasks").update({ notified: true }).eq("id", task.id);
  }

  res.status(200).json({ sent });
}
