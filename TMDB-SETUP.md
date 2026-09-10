# Connect real movie recommendations

The app now fetches live movie discovery from TMDB. There is no sample movie fallback.

1. Create an account at https://www.themoviedb.org/signup and verify your email.
2. Open https://www.themoviedb.org/settings/api and apply for developer API access. Complete the application yourself and review TMDB's terms. Describe this project as a personal group movie discovery app. Use your actual project information.
3. Once approved, copy the **API Read Access Token** from your API settings. This is the long read token, not the shorter v3 API key.
4. In VS Code, open the prepared `.env.local` in the project root (alongside `package.json`). If setting up a fresh checkout, copy `.env.example` to `.env.local` first. Set:

   ```env
   TMDB_READ_ACCESS_TOKEN=paste_your_read_access_token_here
   ```

   Keep the token in that file. Don't paste it into chat or add `NEXT_PUBLIC_` to the name. `.env.local` is excluded from Git.
5. In your VS Code **Command Prompt** terminal, stop the dev server with **Ctrl+C**, then run `npm run dev` again.
6. Open the app, enter two or more nicknames, and continue to the movie preferences. Streaming services should load for your country. Choose a genre and click **Find our movies**.

## How discovery works

- Each new night requests current popular, released movies from TMDB using your genre. These are preference-based discovery picks, not personalized AI predictions.
- When services are selected, the movie must be included with a subscription on at least one selected service in the chosen country. With **Any service**, discovery is not restricted to subscriptions; rentals, purchases, and unavailable titles may appear.
- Choose up to 5, 10, or 15 movies. A narrow filter can return fewer. No results produces a message inviting you to adjust filters.
- The returned movie list is frozen for the round and saved in this browser. Refreshing or passing the device does not replace it.
- Results let you look up subscription, rental, and purchase options for the chosen country. Availability comes from JustWatch through TMDB and can change.
- Nicknames and votes stay on this device. Only the movie preferences are sent to the app's server, which queries TMDB.

## Troubleshooting

- **Movie discovery isn't connected**: check the variable name and restart the server after saving `.env.local`.
- **Connection needs attention**: use the API Read Access Token, without a `Bearer ` prefix in the file, and check that TMDB approved your API access.
- **No matching films**: choose a broader genre or **Any service**. Provider coverage differs by country.
- **Library busy/unavailable**: retry later. The app does not substitute invented or sample results.

## Source documentation

- https://developer.themoviedb.org/docs/authentication-application
- https://developer.themoviedb.org/reference/discover-movie
- https://developer.themoviedb.org/reference/movie-watch-providers
- https://developer.themoviedb.org/docs/faq

TMDB's developer API is free for non-commercial use with attribution. Commercial use requires checking its licensing terms. This app includes a credits section; it does not imply TMDB endorsement.

## Checks

Run in Command Prompt from the project folder:

```cmd
node --test tests/room.test.mjs tests/tmdb.test.mjs
npm run lint
npm run build
```

Automated API tests use isolated fake responses, not a live API credential. Complete step 6 to verify your actual account connection.
