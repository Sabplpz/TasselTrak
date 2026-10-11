export const NextResponse = {
  json: (data: unknown, init?: { status?: number }) => Response.json(data, init),
};
