# Customer Service Scheduler Web Design

## Goal

Expose online customer-service scheduling in the local web console so each coworker can use it with their own EasyExam tenant API keys.

The scheduler opens EasyExam online customer service from 24 hours before an exam starts until the exam ends, then closes it after the exam ends.

## Core Rule

Changing or saving a new tenant API Key must not overwrite or disable previous keys.

Each user owns a list of API Key profiles. When a user saves a new API Key:

- A new profile is created when the key is not already saved.
- The new profile becomes the current profile for manual operations.
- Existing profiles remain saved.
- Existing profiles keep their online customer-service scheduler enabled by default.

## Scope

In scope:

- Add per-user API Key profile storage.
- Add per-profile customer-service scheduler settings and last-run status.
- Add web UI on the Auto Config page.
- Add APIs for listing, saving, enabling, disabling, deleting, setting current profile, and running a manual scheduler check.
- Change the hourly scheduler to iterate every enabled API Key profile for every user.

Out of scope:

- Sharing one user's API Key with another user.
- Per-exam custom schedules.
- Changing Udesk settings.
- Browser automation against EasyExam.

## Data Model

Extend `user_settings.json` per user:

```json
{
  "users": {
    "chenjun@ata.net.cn": {
      "login": {
        "tenantApiKey": "current-key"
      },
      "apiKeyProfiles": [
        {
          "id": "profile_...",
          "label": "末尾 abcd",
          "apiBase": "https://eztest.cn",
          "tenantApiKey": "secret",
          "current": true,
          "customerServiceScheduler": {
            "enabled": true,
            "intervalMinutes": 60,
            "lastRunAt": "",
            "lastSummary": null,
            "lastError": ""
          },
          "createdAt": "2026-07-02T00:00:00.000Z",
          "updatedAt": "2026-07-02T00:00:00.000Z"
        }
      ]
    }
  }
}
```

Compatibility:

- Existing `login.tenantApiKey` remains supported.
- On save, if the submitted key is not in `apiKeyProfiles`, add it as a scheduler-enabled profile.
- If old users only have `login.tenantApiKey`, the settings API should surface it as one profile.

## Web UI

Place a new section under "后台连接" on the Auto Config page:

- Title: `在线客服定时`
- Summary: `开考前 24 小时打开，考试结束后关闭。每小时巡检一次。`
- Master state for the current profile.
- List of saved API Key profiles:
  - label or key hint
  - current marker
  - scheduler enabled state
  - last run summary
  - actions: `设为当前`, `暂停定时`, `恢复定时`, `删除`
- Button: `立即试跑`

The UI never displays full API Keys. It only shows a key hint such as the last four characters.

## APIs

Add authenticated APIs:

- `GET /api/customer-service-scheduler`
  - Returns current user's profiles and LaunchAgent status if available.
- `POST /api/customer-service-scheduler/profiles`
  - Saves or updates a profile for the submitted API Key.
  - Sets it as current.
  - Keeps existing profiles enabled unless explicitly changed.
- `PATCH /api/customer-service-scheduler/profiles/:profileId`
  - Allows current, label, and scheduler enabled changes.
- `DELETE /api/customer-service-scheduler/profiles/:profileId`
  - Deletes one profile. If deleting current, another remaining profile becomes current.
- `POST /api/customer-service-scheduler/run`
  - Runs the scheduler for the current user, or one profile when `profileId` is provided.
  - Supports `dryRun: true`.

All APIs operate on the authenticated user only, except auth-disabled local mode uses the legacy settings as one local user.

## Hourly Scheduler

The LaunchAgent still runs once per hour.

The CLI loads all user settings and builds one scheduler target per enabled profile:

- authenticated users: every profile with `customerServiceScheduler.enabled === true`
- auth-disabled local mode: legacy login settings as one profile

For each target, the scheduler uses that profile's `apiBase` and `tenantApiKey`, then stores last-run status back into the same profile.

One profile failing must not stop other profiles.

## Error Handling

- Missing key: profile is skipped with `lastError`.
- 401/403 from EasyExam: profile records failure and remains enabled.
- Per-session update failure: profile records failed count but continues scanning later sessions.
- Deleting a profile is explicit. Saving a new key never deletes old keys.

## Testing

Add tests for:

- Saving a new API Key creates a new profile and preserves old profiles.
- Re-saving an existing key reuses its profile and sets it current.
- Old profiles remain scheduler-enabled after switching current key.
- The hourly scheduler runs all enabled profiles and skips disabled ones.
- One failed profile does not stop another profile.
- Settings API never returns full API Keys.
- UI renders online customer-service scheduler controls.

## Operational Notes

Existing single-key scheduler behavior remains useful as a fallback, but the web-integrated scheduler should become the default path. The installed LaunchAgent should call the new multi-profile CLI mode after implementation.
