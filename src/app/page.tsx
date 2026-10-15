import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { listCards } from "@/server/cards";
import { Wallet } from "@/components/wallet";

export const dynamic = "force-dynamic";
export default async function Home() {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
        redirect("/login");
    }
    return (
        <Wallet
            initialCards={await listCards(session.user.id)}
            userName={session.user.name}
        />
    );
}
