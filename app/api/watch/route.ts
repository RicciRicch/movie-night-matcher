import { apiError, watchProviders } from "../../../lib/tmdb";

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    return Response.json(await watchProviders(Number(query.get("id")), query.get("country") ?? "RS"));
  } catch (error) { return apiError(error); }
}
