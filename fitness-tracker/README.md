# Lift Log

A bare-bones, offline-first personal fitness tracker for Android. Plain HTML/CSS/JS with no build step. It installs from Chrome as an app (PWA) and will also be wrapped as an APK.

**Live app:** https://menonblack.github.io/my-apps/fitness/

## What it does

- **Log**: one day's workout. Add any exercise (autocomplete from a seed list plus everything you've typed), pick a muscle group, and log sets as weight × reps (miles and minutes for cardio). A new set copies your last set or your last session. Deleting uses an in-page two-step confirm. You can copy a day to another date, or use "Copy previous workout" on an empty day. Planned workouts show here with **Start** and **Skip**.
- **Calendar**: month view with muscle-colour dots, today marker, planned days, and a workout count. Tap a day to open it. **Save backup** downloads everything as JSON; **Restore** imports it after a confirm step.
- **Body**: check-ins with photo, weight (lb), height (in, remembered), optional tape waist (in) and date. **Estimate from photo** asks Claude for a rough waist and body-fat range, labelled *est.* A tape measurement overrides the estimate in trends. Only a ~240 px thumbnail is kept. Weight and waist tiles show sparklines. **Write progress report** sends check-ins plus training stats (workout days in the last 28 days and Epley e1RM change per lift) to Claude for a report under 170 words.
- **Coach**: chat with Claude as a workout partner. It reads your log, plan and check-ins through tools. It can plan days, skip or cancel workouts, log what you say you did, and save memories about you. Every change shows an **Undo** button. Your profile, ground rules and memories are in Settings.

Units are lb and inches. Data stays on the device (IndexedDB). There are no accounts and no backend. Log and Calendar work fully without an API key.

## Claude API key

Paste your own Anthropic API key in **Settings**. It is stored only on the device. It is never in this repo, never in the code, and never in backup files, and it is sent only to `api.anthropic.com`. The app uses the official Anthropic SDK (bundled at `web/vendor/anthropic-sdk.js`, rebuilt with `tools/build-sdk.sh`) with browser access enabled.

> This is fine for a **personal** app on your own phone. A **shared** app must not ship keys to browsers. It would need a small server proxy that holds the key and forwards requests.

Model: Claude Opus 5.5 by default. Sonnet 5.5 or Haiku 5.5 can be picked in Settings to save cost. On Opus and Sonnet, requests opt into Anthropic's server-side refusal fallback. The app never retries on its own: errors (missing key, bad key, rate limit, network, bad JSON) show plain-language text and a **Retry** button.

### Coach guardrails

- Built-in safety rules: not a doctor, sends red-flag symptoms to a professional, no medication or PED dosing, no crash diets, gradual progression, no identity comments on photos.
- Your **ground rules** (Settings) are added to every new chat. Built-in safety rules win if they conflict.
- Coach cannot delete logged workouts. It can only plan from today up to 90 days ahead. It asks before changing more than 3 days at once.
- Memories are visible and deletable in Settings. A chat's instructions are fixed when it starts, so profile and rule edits apply from the next **New chat**.

## Deploy

`.github/workflows/fitness-pages.yml` publishes `fitness-tracker/web` to the `gh-pages` branch under `/fitness/` on every push. GitHub Pages serves that branch. Bump `VERSION` in `web/sw.js` on each release so installed apps pick up the new files.

## Manual test checklist

1. **Log a workout**: Log tab → type "ben" → tap *Bench Press* → enter 135 and 8 → **+ Add set** twice (prefilled 135 × 8). Add "Running" as Cardio with 2 mi / 20 min. Delete a set (tap ✕, then "Delete?").
2. **Copy it to another day**: **Copy to another day** → pick tomorrow → **Copy** → **Open** in the message. The exercises are there. Go one more day ahead → **Copy previous workout**.
3. **Back up and restore**: Calendar → **Save backup** (file in Downloads) → **Restore** → pick the file → **Replace my data**.
4. **Photo estimate**: Settings → paste API key → **Test key**. Body → **Take photo** or **From gallery** → enter weight → **Estimate from photo**. Ranges appear marked *est.* → **Save check-in**. Add a second check-in with a tape waist; the waist tile uses the tape value.
5. **Progress report**: Body → **Write progress report**. Expect three sections (Body, Training, Next two weeks), under 170 words. Reopen the app and it is still there.
6. **Coach**: Coach → "Cancel my workout today" → today shows as skipped in Log. "Plan my week" → planned days appear in Calendar. Tap **Undo** on a change. Turn off Wi-Fi/data and send a message: you get the connection error and Retry.
7. **Offline**: airplane mode → open the app from the home screen → Log and Calendar work.
