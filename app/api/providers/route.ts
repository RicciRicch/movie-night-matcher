import { apiError, getProviders } from "../../../lib/tmdb";

export async function GET(request: Request) {
  try {
    const country = new URL(request.url).searchParams.get("country") ?? "RS";
    return Response.json({ providers: await getProviders(country) });
  } catch (error) { return apiError(error); }
}
