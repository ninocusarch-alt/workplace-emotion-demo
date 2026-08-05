import { clearUser, getDatabase } from "@/lib/server/database";
import { errorResponse } from "@/lib/server/http";
import {
  clearIdentityCookie,
  getIdentity,
  jsonWithIdentity,
} from "@/lib/server/identity";

export async function DELETE(request: Request) {
  let identity;
  try {
    identity = await getIdentity(request);
    const database = await getDatabase();
    await clearUser(database, identity.user.id);
    const response = jsonWithIdentity(identity, { ok: true });
    response.headers.set("set-cookie", clearIdentityCookie(request.url));
    return response;
  } catch (error) {
    return errorResponse(error, identity);
  }
}
