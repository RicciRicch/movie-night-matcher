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

export type RecommendationFilters = {
  seeds: number[];
  exclude: number[];
  country: string;
  services: string[];
  limit: number;
};

function movieIds(value: unknown, maximum: number) {
  if (!Array.isArray(value) || value.length > maximum ||
      !value.every((id) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return null;
  return [...new Set(value as number[])];
}

export function parseRecommendationFilters(value: unknown): RecommendationFilters {
  if (!object(value) || typeof value.country !== "string")
    throw new MovieDataError("Choose valid movies to build the next round.", 400, "INVALID_FILTERS");
  validateCountry(value.country);
  const seeds = movieIds(value.seeds, 3);
  const exclude = movieIds(value.exclude, 20);
  if (!seeds?.length || !exclude || !Array.isArray(value.services) || value.services.length > 30 ||
      !value.services.every((id) => typeof id === "string" && /^\d{1,6}$/.test(id)) ||
      typeof value.limit !== "number" || ![5, 10, 15].includes(value.limit))
    throw new MovieDataError("Choose valid movies to build the next round.", 400, "INVALID_FILTERS");
  return {
    seeds,
    exclude,
    country: value.country,
    services: [...new Set(value.services)] as string[],
    limit: value.limit,
  };
}

async function subscriptionProviderIds(id: number, country: string, fetcher: Fetcher) {
  const data = await request(`/movie/${id}/watch/providers`, fetcher);
  const region = object(data.results) && object(data.results[country]) ? data.results[country] : {};
  if (!Array.isArray(region.flatrate)) return [];
  return region.flatrate.filter(object)
    .map((provider) => provider.provider_id)
    .filter((providerId): providerId is number => typeof providerId === "number" && Number.isSafeInteger(providerId));
}

export async function recommendMovies(filters: RecommendationFilters, fetcher: Fetcher = fetch) {
  if (filters.services.length) {
    const available = await getProviders(filters.country, fetcher);
    if (filters.services.some((id) => !available.some((provider) => provider.id === id)))
      throw new MovieDataError("A selected service isn’t listed in this country. Update your services and try again.", 400, "INVALID_FILTERS");
  }

  const recommendationLists = await Promise.all(filters.seeds.map((id) =>
    request(`/movie/${id}/recommendations?language=en-US&page=1`, fetcher)));
  const excluded = new Set([...filters.exclude, ...filters.seeds]);
  const ranked = new Map<number, { movie: Movie; score: number; first: number }>();
  const today = new Date().toISOString().slice(0, 10);

  recommendationLists.forEach((data, seedIndex) => {
    if (!Array.isArray(data.results))
      throw new MovieDataError("Similar movie picks couldn’t be loaded. Please try again.");
    data.results.forEach((item, resultIndex) => {
      const releaseDate = object(item) && typeof item.release_date === "string" ? item.release_date : "";
      const movie = normalizeMovie(item);
      if (!movie || excluded.has(movie.id) || (releaseDate && releaseDate > today)) return;
      const existing = ranked.get(movie.id);
      const relevance = 100 + Math.max(0, 20 - resultIndex) + (filters.seeds.length - seedIndex) * 5;
      ranked.set(movie.id, {
        movie,
        score: (existing?.score ?? 0) + relevance,
        first: existing?.first ?? seedIndex * 100 + resultIndex,
      });
    });
  });

  const candidates = [...ranked.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first || a.movie.id - b.movie.id)
    .map((entry) => entry.movie);
  if (!filters.services.length) return candidates.slice(0, filters.limit);

  const selected = new Set(filters.services.map(Number));
  const matches: Movie[] = [];
  // Check the strongest candidates in small batches so provider filtering stays responsive.
  for (let index = 0; index < Math.min(candidates.length, 30) && matches.length < filters.limit; index += 6) {
    const batch = candidates.slice(index, index + 6);
    const providerLists = await Promise.all(batch.map((movie) =>
      subscriptionProviderIds(movie.id, filters.country, fetcher)));
    batch.forEach((movie, batchIndex) => {
      if (matches.length < filters.limit && providerLists[batchIndex].some((id) => selected.has(id))) matches.push(movie);
    });
  }
  return matches;
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
