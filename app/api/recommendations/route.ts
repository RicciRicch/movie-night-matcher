import { apiError, MovieDataError, parseRecommendationFilters, recommendMovies } from "../../../lib/tmdb";

export async function POST(request: Request) {
  try {
    let body: unknown;
    try { body = await request.json(); }
    catch { throw new MovieDataError("Choose valid movies to build the next round.", 400, "INVALID_FILTERS"); }
    const filters = parseRecommendationFilters(body);
    return Response.json({ movies: await recommendMovies(filters) });
  } catch (error) { return apiError(error); }
}
