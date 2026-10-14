// Supabase Edge Function: send-reminders
// Called every minute by pg_cron. Finds tasks whose reminder is coming up / due / overdue
// and sends a web push notification to every device the task owner turned reminders on for.
// Also handles {test:true} from a logged-in user to send a test notification.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

async function pushToUser(userId: string, msg: Record<string, string>) {
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("user_id", userId);
  let sent = 0;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(msg),
        { TTL: 1800, urgency: "high" },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
      else console.error("push failed", code, (e as Error).message);
    }
  }
  return sent;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Test notification from the app (needs the user's login token)
  if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    const body = await req.json().catch(() => ({}));
    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
    const { data } = jwt ? await sb.auth.getUser(jwt) : { data: { user: null } };
    if (!body.test || !data.user) return new Response("unauthorized", { status: 401, headers: cors });
    const sent = await pushToUser(data.user.id, {
      title: "🔔 Reminders are working!",
      body: "You'll hear from me before a task starts, before its deadline, and if the deadline passes.",
      tag: "test",
    });
    return Response.json({ sent }, { headers: cors });
  }

  // Scheduled run
  const { data: due, error } = await sb.rpc("due_reminders");
  if (error) return new Response(error.message, { status: 500 });

  let sent = 0;
  for (const r of due ?? []) {
    // Log first so a reminder never goes out twice, even if two runs overlap
    const { error: dup } = await sb.from("reminder_log").insert({ task_id: r.task_id, stage: r.stage, due_at: r.event_at });
    if (dup) continue;
    const mins = Math.max(1, Math.round((new Date(r.event_at).getTime() - Date.now()) / 60000));
    const msg =
      r.stage === "start_soon" ? { title: `⏳ Starting soon: ${r.title}`, body: `Starts at ${r.at_time} — in ${mins} min. Get ready!` }
      : r.stage === "start" ? { title: `▶️ Time to start: ${r.title}`, body: `It's ${r.at_time}. Let's begin — you've got this!` }
      : r.stage === "due_soon" ? { title: `⏰ Deadline soon: ${r.title}`, body: `Deadline at ${r.at_time} — ${mins} min left. Finish strong!` }
      : { title: `⚠️ Deadline passed: ${r.title}`, body: `It was due at ${r.at_time}. Please complete it now 💪` };
    sent += await pushToUser(r.user_id, { ...msg, tag: "rem-" + r.task_id, url: "./" });
  }

  await sb.from("reminder_log").delete().lt("sent_at", new Date(Date.now() - 7 * 864e5).toISOString());
  return Response.json({ due: due?.length ?? 0, sent });
});
