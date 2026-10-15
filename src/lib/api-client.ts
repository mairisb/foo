export async function api<T>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    const response = await fetch(path, {
        ...options,
        headers: {
            ...(options.body instanceof FormData
                ? {}
                : { "Content-Type": "application/json" }),
            ...options.headers,
        },
        cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error(
            data.error ?? "Something went wrong. Please try again.",
        );
    }
    return data as T;
}
