import type { Movie, Provider } from "./room";

const api = "https://api.themoviedb.org/3";
const genres: Record<string, number> = { "sci-fi": 878, comedy: 35, animation: 16, action: 28, drama: 18, thriller: 53, romance: 10749, horror: 27 };
const countries = ["RS", "GB", "US", "DE", "FR"];
type Fetcher = typeof fetch;
export class MovieDataError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 502, code = "UNAVAILABLE") {
    super(message); this.status = status; this.code = code;
  }
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function token() {
  const value = process.env.TMDB_READ_ACCESS_TOKEN?.trim();
  if (!value) throw new MovieDataError("Movie discovery isn’t connected yet. Ask the host to finish the TMDB setup, then try again.", 503, "NOT_CONFIGURED");
  return value;
}
async function request(path: string, fetcher: Fetcher) {
  const accessToken = token();
  let response: Response;
  try {
    response = await fetcher(api + path, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      cache: "no-store", signal: AbortSignal.timeout(12000),
    });
  } catch { throw new MovieDataError("We couldn’t reach the movie library. Please try again in a moment."); }
  if (response.status === 401 || response.status === 403)
    throw new MovieDataError("The movie connection needs attention. Ask the host to check their TMDB access token.", 503, "AUTH_FAILED");
  if (response.status === 429)
    throw new MovieDataError("The movie library is busy. Please wait a moment and try again.", 429, "RATE_LIMITED");
  if (!response.ok) throw new MovieDataError("The movie library is temporarily unavailable. Please try again.");
  try {
    const data: unknown = await response.json();
    if (!object(data)) throw new Error();
    return data;
  } catch { throw new MovieDataError("The movie library returned an unreadable response. Please try again."); }
}
export function validateCountry(country: string) {
  if (!countries.includes(country)) throw new MovieDataError("Choose a supported country.", 400, "INVALID_FILTERS");
  return country;
}
export async function getProviders(country: string, fetcher: Fetcher = fetch): Promise<Provider[]> {
  validateCountry(country);
  const data = await request(`/watch/providers/movie?watch_region=${country}&language=en-US`, fetcher);
  if (!Array.isArray(data.results)) throw new MovieDataError("Streaming services couldn’t be loaded. Please try again.");
  return data.results.filter(object)
    .filter((item) => Number.isInteger(item.provider_id) && typeof item.provider_id === "number" && item.provider_id > 0 && typeof item.provider_name === "string")
    .sort((a, b) => Number(a.display_priority ?? 999) - Number(b.display_priority ?? 999))
    .map((item) => ({ id: String(item.provider_id), name: String(item.provider_name) }));
}
export type DiscoveryFilters = { country: string; genre: string; services: string[]; limit: number };
export function parseFilters(value: unknown): DiscoveryFilters {
  if (!object(value) || typeof value.country !== "string" || typeof value.genre !== "string")
    throw new MovieDataError("Choose your movie preferences first.", 400, "INVALID_FILTERS");
  validateCountry(value.country);
  if (value.genre !== "all" && !Object.hasOwn(genres, value.genre))
    throw new MovieDataError("Choose a supported genre.", 400, "INVALID_FILTERS");
  if (!Array.isArray(value.services) || value.services.length > 30 ||
    !value.services.every((id) => typeof id === "string" && /^\d{1,6}$/.test(id)) ||
    typeof value.limit !== "number" || ![5, 10, 15].includes(value.limit))
    throw new MovieDataError("Choose a valid round length and streaming services.", 400, "INVALID_FILTERS");
  return { country: value.country, genre: value.genre, services: [...new Set(value.services)] as string[], limit: value.limit };
}
export function discoverQuery(filters: DiscoveryFilters) {
  const query = new URLSearchParams({ language: "en-US", include_adult: "false", include_video: "false",
    sort_by: "popularity.desc", "primary_release_date.lte": new Date().toISOString().slice(0, 10), page: "1" });
  if (filters.genre !== "all") query.set("with_genres", String(genres[filters.genre]));
  if (filters.services.length) {
    query.set("watch_region", filters.country);
    query.set("with_watch_providers", filters.services.join("|"));
    query.set("with_watch_monetization_types", "flatrate");
  }
  return query;
}
export function normalizeMovie(value: unknown): Movie | null {
  if (!object(value) || typeof value.id !== "number" || !Number.isInteger(value.id) || value.id <= 0 ||
    typeof value.title !== "string" || !value.title.trim() || value.adult === true) return null;
  const year = typeof value.release_date === "string" && /^\d{4}-/.test(value.release_date) ? value.release_date.slice(0, 4) : "Year unavailable";
  const names = Array.isArray(value.genre_ids) ? Object.entries(genres)
    .filter(([, id]) => (value.genre_ids as unknown[]).includes(id))
    .map(([name]) => name === "sci-fi" ? "Sci-fi" : name[0].toUpperCase() + name.slice(1)) : [];
  return {
    id: value.id, title: value.title.trim(), details: [year, ...names.slice(0, 2)].join(" · "),
    description: typeof value.overview === "string" && value.overview.trim() ? value.overview : "No synopsis is available for this movie yet.",
    poster: typeof value.poster_path === "string" && /^\/[a-zA-Z0-9_.-]+$/.test(value.poster_path) ? `https://image.tmdb.org/t/p/w500${value.poster_path}` : null,
    rating: typeof value.vote_average === "number" && value.vote_average > 0 && value.vote_average <= 10 && Number(value.vote_count) > 0 ? value.vote_average : null,
  };
}
export async function discoverMovies(filters: DiscoveryFilters, fetcher: Fetcher = fetch) {
  if (filters.services.length) {
    const available = await getProviders(filters.country, fetcher);
    if (filters.services.some((id) => !available.some((provider) => provider.id === id)))
      throw new MovieDataError("A selected service isn’t listed in this country. Update your services and try again.", 400, "INVALID_FILTERS");
  }
  const data = await request(`/discover/movie?${discoverQuery(filters)}`, fetcher);
  if (!Array.isArray(data.results)) throw new MovieDataError("Movie picks couldn’t be loaded. Please try again.");
  const unique = new Map<number, Movie>();
  for (const item of data.results) { const movie = normalizeMovie(item); if (movie) unique.set(movie.id, movie); }
  const movies = [...unique.values()];
  // Shuffle live discovery results once. The room stores this exact list for every voter.
  for (let i = movies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [movies[i], movies[j]] = [movies[j], movies[i]];
  }
  return movies.slice(0, filters.limit);
}
export async function watchProviders(id: number, country: string, fetcher: Fetcher = fetch) {
  validateCountry(country);
  if (!Number.isSafeInteger(id) || id < 1) throw new MovieDataError("Choose a valid movie.", 400, "INVALID_MOVIE");
  const data = await request(`/movie/${id}/watch/providers`, fetcher);
  const region = object(data.results) && object(data.results[country]) ? data.results[country] : {};
  const names = (kind: string) => Array.isArray(region[kind]) ? [...new Set(region[kind].filter(object)
    .map((provider) => provider.provider_name).filter((name): name is string => typeof name === "string"))] : [];
  return { subscription: names("flatrate"), rent: names("rent"), buy: names("buy"),
    link: `https://www.themoviedb.org/movie/${id}/watch?locale=${country}` };
}
export function apiError(error: unknown) {
  if (error instanceof MovieDataError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: "Something went wrong loading movies. Please try again.", code: "UNAVAILABLE" }, { status: 502 });
}
