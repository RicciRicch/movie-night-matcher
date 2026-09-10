import { apiError, discoverMovies, MovieDataError, parseFilters } from "../../../lib/tmdb";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new MovieDataError("Choose your movie preferences first.", 400, "INVALID_FILTERS"); }
    const filters = parseFilters(body);
    return Response.json({ movies: await discoverMovies(filters) });
  } catch (error) { return apiError(error); }
}
