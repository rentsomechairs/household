# Household Hub

A touch-friendly household dashboard designed for GitHub Pages, Amazon Echo Show/Silk, phones, tablets, and desktop browsers.

## Run locally on Windows

Do not open `index.html` through a `file:///` address. Extract the ZIP and double-click:

```text
Start_Household_Hub.bat
```

The launcher starts a local Python HTTP server and opens Chrome Incognito at `http://127.0.0.1:8000/`. If Chrome is unavailable, it tries Microsoft Edge InPrivate. Keep the command window open while using the app and press Ctrl+C to stop it.

## Firebase configuration

This build is configured for:

```text
Firebase project: household-2c5e2
Household path: households/primary-home
```

Google Authentication must be enabled. Add these under **Authentication → Settings → Authorized domains**:

- `localhost`
- your GitHub Pages hostname, such as `your-account.github.io`

Publish the included `firestore.rules` under **Firestore Database → Rules**.

## Firebase is the source of truth

Calendar events, household profiles, tasks, task completions, lists, list items, and settings are stored in Firestore. Opening the site in an Incognito/InPrivate window and signing in loads the same information from Firebase.

The browser still stores Firebase's authentication persistence for the active browser session. That is normal and only controls whether Google keeps the user signed in. Household content is not stored in localStorage.

Closing every Incognito window normally clears the Incognito authentication session, so Google may ask you to sign in again next time. After signing in, all household content returns from Firestore.

## Optimized Firestore structure

The app no longer rewrites one large household document for every change. It uses separate documents:

```text
households/primary-home
households/primary-home/configuration/settings
households/primary-home/members/{uid}
households/primary-home/events/{eventId}
households/primary-home/tasks/{taskId}
households/primary-home/lists/{listId}
households/primary-home/completions/{taskId__date}
```

Examples:

- Completing a task writes or deletes only one completion document.
- Adding an event writes only that event document.
- Deleting a task deletes only that task document.
- Editing a list writes only that list document.
- Saving household settings updates only the settings document.

An older single-document Household Hub database is migrated automatically the first time this version loads successfully.

## Loading indicators

A blocking loading indicator appears for initial Firebase loading, manual refreshes, profile changes, and writes that should not be interrupted. Task checkmarks update immediately and sync in the background, reverting if Firebase rejects the write.

## Security note

The included starter rules require Google authentication, but any authenticated Google account that can reach the app can currently access `primary-home`. Before sharing the URL publicly, restrict access to your household members' Firebase UIDs or implement invitation-based membership rules.

## Echo Show / Silk Google sign-in

The app detects Amazon Silk and uses Firebase `signInWithRedirect()` rather than a popup. Desktop browsers continue to use popup sign-in, with an automatic redirect fallback if a popup is blocked. After Google returns to the app, Firebase restores the authentication session and the pending profile nickname is saved to Firestore.
