# Movie Night Matcher

Movie Night Matcher helps a group choose a film without spending the evening scrolling through streaming apps.

Add everyone who is watching, choose a country, genre, streaming services, and round length, then pass one device around. Each person privately votes **Pass** or **I'd watch it** on the same movies. When everyone finishes, the app reveals any unanimous matches. If there is no unanimous choice, it shows the group's most-liked shortlist.

Movie suggestions, posters, ratings, and streaming availability come from [TMDB](https://www.themoviedb.org). Streaming availability data is supplied through TMDB by [JustWatch](https://www.justwatch.com).

## How to play

1. Open Movie Night Matcher on one device.
2. Enter a nickname for every person who will vote. At least two voters are required.
3. Select your country and how many movies each person should see: 5, 10, or 15.
4. Choose a genre, or select **A little of everything**.
5. Optionally select the streaming services your group has. When services are selected, the app looks for films included with a subscription on at least one of them in your country.
6. Select **Find our movies**. The app fetches a fresh set of released, popular films from TMDB and keeps that same list for every voter.
7. Pass the device to the person shown on screen. They select **Let's find a favorite** and privately vote on every movie.
8. At the end of a turn, submit the votes and pass the device to the next person. Submitted choices stay hidden until everyone has finished.
9. After the final voter submits, reveal the result:
   - A **match** means everyone liked the movie.
   - If there is no match, the app ranks films by the number of likes.
   - If everyone passed on everything, start another night with broader preferences.
10. For a result, select **Where can we watch?** to check subscription, rental, and purchase options for the chosen country.

You can undo the latest vote before submitting a turn. Refreshing the browser preserves the room, current voter, movie list, and completed votes on that device.

## Current version

The app currently supports:

- Any number of voters, with a minimum of two.
- Private pass-and-play voting on one shared device.
- Live TMDB movie discovery with posters, summaries, genres, release years, and TMDB ratings.
- Country-specific streaming-service filters.
- Unanimous matches and a ranked fallback shortlist.
- Streaming, rental, and purchase availability after voting.
- Browser storage for refresh recovery.
- Responsive desktop and mobile layouts.

The current version does not yet provide online rooms or invite links. Nicknames, the selected movie list, and votes stay in the browser on the device running the game. Supabase-backed rooms for voting from separate devices are planned for a later version.

## Run it locally

### Requirements

- [Node.js](https://nodejs.org) 20 or newer.
- npm.
- A TMDB account with developer API access.

Clone the repository and enter its directory:

```cmd
git clone https://github.com/RicciRicch/movie-night-matcher.git
cd movie-night-matcher
```

Install the dependencies:

```cmd
npm install
```

Copy the environment template:

```cmd
copy .env.example .env.local
```

Open `.env.local` and add your TMDB **API Read Access Token**:

```env
TMDB_READ_ACCESS_TOKEN=your_read_access_token_here
```

Do not add `NEXT_PUBLIC_` to this variable. The token is used only by the app's server routes and must not be exposed in browser code. `.env.local` is ignored by Git.

Start the development server:

```cmd
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If that port is already in use, use the alternative address printed in the terminal.

More detailed account instructions and troubleshooting are available in [TMDB-SETUP.md](TMDB-SETUP.md).

## How movie discovery works

When a room starts, the server requests currently released movies from TMDB and applies the group's selected genre. If streaming services are selected, it also filters by the chosen country and looks for subscription availability on at least one selected service.

TMDB can return fewer movies than the requested round length when the filters are narrow. Selecting **Any service** removes the subscription filter, so results may include movies available only to rent or buy, or movies without current availability data in that country.

The returned list is shuffled once and saved with the room. Every voter therefore sees the same films in the same order, even after a refresh. Starting a new movie night requests a fresh list.

These are preference-based discovery suggestions rather than personalized AI recommendations. The app does not use viewing history or user accounts.

## Project structure

- `app/page.tsx` contains the setup, voting, handover, and results screens.
- `app/api/movies/route.ts` securely requests movie discovery from TMDB.
- `app/api/providers/route.ts` loads streaming services for the selected country.
- `app/api/watch/route.ts` loads availability for result movies.
- `components/MovieCard.tsx` displays a movie and its voting controls.
- `components/WatchOptions.tsx` displays streaming, rental, and purchase options.
- `lib/room.ts` contains room state, voting, persistence validation, and result tallying.
- `lib/tmdb.ts` contains TMDB requests, filter validation, and response normalization.
- `tests/` contains room and TMDB integration tests using isolated mock responses.

## Technology

- [Next.js](https://nextjs.org) with the App Router.
- [React](https://react.dev) and TypeScript.
- [Tailwind CSS](https://tailwindcss.com), with custom responsive styling.
- [TMDB API](https://developer.themoviedb.org) for movie data and images.
- JustWatch availability data through TMDB.
- Browser `localStorage` for the current pass-and-play room.

## Checks

Run the automated tests:

```cmd
node --test tests\room.test.mjs tests\tmdb.test.mjs
```

Check the code style:

```cmd
npm run lint
```

Create a production build:

```cmd
npm run build
```

The automated TMDB tests use mock responses and do not require or expose a real API token. Test one complete room manually after connecting your own token.

## Data and credits

Movie data and images are provided by TMDB. Streaming availability is provided by JustWatch through TMDB and can change over time.

This product uses the TMDB API but is not endorsed or certified by TMDB.

TMDB's developer API is available for non-commercial use subject to its terms and attribution requirements. Review the [TMDB API documentation](https://developer.themoviedb.org/docs/getting-started) and licensing requirements before using the app commercially.
