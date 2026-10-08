import { env } from "cloudflare:workers";
import { handleGameRequest } from "../../lib/room-service.mjs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleGameRequest(request, env.DB);
export const POST = GET;
