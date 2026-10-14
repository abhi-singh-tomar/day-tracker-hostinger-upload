# Reminders when the app is closed — one-time setup

The app sends reminders through web push. A small server job in Supabase checks every minute and,
for every task that isn't done yet, sends a notification:
- 15 min before its **start time** ("Starting soon") and at the start time ("Time to start")
- 15 min before its **deadline** ("Deadline soon") and right after the deadline passes ("Deadline passed — complete it")

`setup.sql` also adds the `start_time` column to your `tasks` table. It is safe to run again if you
already ran an older version.

Your secret values are in `Downloads\day-tracker-PRIVATE-push-keys.txt` (not in this folder — keep it private).

You don't need to upload this `supabase` folder to Hostinger.

## 1. Create the tables
Supabase dashboard → **SQL Editor** → New query → paste all of `setup.sql` → **Run**.

## 2. Add the secrets
Dashboard → **Edge Functions** → **Secrets** → add these three (values from the private file):
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `CRON_SECRET`

## 3. Create the function
Dashboard → **Edge Functions** → **Deploy a new function** → **Via Editor**
- Name it exactly `send-reminders`
- Replace the sample code with all of `functions/send-reminders/index.ts`
- Click **Deploy**
- Open the function's **Details/Settings** and turn **OFF** "Verify JWT" ("Enforce JWT verification"). The function checks its own secret.

## 4. Start the every-minute job
**SQL Editor** → paste the `cron.schedule(...)` block from the private file → **Run**.

## 5. Turn it on in the app
1. Upload the site files to Hostinger (it must be served over **https**).
2. Open the site, log in, tap **🔔 Turn on reminders**, allow notifications.
3. Tap **Send test notification** — a notification should appear within a few seconds.
4. Install the app:
   - **Android / Chrome / Edge:** browser menu → **Install app** (or "Add to Home screen").
   - **iPhone:** Safari → Share → **Add to Home Screen**, open it from the home screen, then tap **Turn on reminders** inside the installed app (iOS 16.4+).
5. Do step 2–3 on every device you want reminders on.

## Troubleshooting
- **Test says "is the server part set up?"** → check step 3 (name must be `send-reminders`, JWT verification off).
- **Test works but scheduled reminders don't arrive** → check step 4, and in the SQL Editor run
  `select * from cron.job_run_details order by start_time desc limit 5;` to see if the job runs.
- **Function logs** (Edge Functions → send-reminders → Logs) show any push errors.
- **No sound on a phone** → the notification uses your phone's notification sound; make sure the
  browser/app's notifications aren't set to silent and the phone isn't on Do Not Disturb.
