// A failed request. `message` finishes the sentence "We couldn't load … because", and `status`
// is the HTTP status when the server answered.
export class FetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// Fetches JSON with a 20 second timeout. Failures throw a FetchError.
export async function getJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new FetchError(timedOut ? "the server took too long to answer" : "the connection dropped");
  }
  if (!res.ok) throw new FetchError(`the server returned an error (${res.status})`, res.status);
  try {
    return (await res.json()) as T;
  } catch {
    throw new FetchError("the server sent a response we couldn’t read");
  }
}

export const reasonOf = (e: unknown) => (e instanceof Error ? e.message : "something went wrong");
