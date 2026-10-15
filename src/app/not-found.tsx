import Link from "next/link";
export default function NotFound() {
    return (
        <main className="mx-auto max-w-2xl px-4 py-6">
            <h1 className="mb-4 text-2xl font-semibold">Page not found</h1>
            <Link href="/" className="underline underline-offset-4">
                Back to cards
            </Link>
        </main>
    );
}
