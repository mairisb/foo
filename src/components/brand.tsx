import Image from "next/image";
import Link from "next/link";

export function Brand() {
    return (
        <Link
            href="/"
            aria-label="foo home"
            className="inline-flex shrink-0 items-center gap-2 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-4"
        >
            <Image
                src="/icon.svg?v=5"
                alt=""
                aria-hidden="true"
                width={32}
                height={32}
                className="size-8 shrink-0"
                unoptimized
            />
            <span>foo</span>
        </Link>
    );
}
