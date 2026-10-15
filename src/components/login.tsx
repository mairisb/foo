"use client";
import { useState } from "react";
import { Field as BaseField } from "@base-ui/react/field";
import { Form } from "@base-ui/react/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
} from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";
import { Brand } from "./brand";

export function Login() {
    const [creating, setCreating] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function submit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setBusy(true);
        const data = new FormData(event.currentTarget);
        try {
            const credentials = {
                email: String(data.get("email")),
                password: String(data.get("password")),
            };
            const result = creating
                ? await authClient.signUp.email({
                      ...credentials,
                      name: String(data.get("name")),
                  })
                : await authClient.signIn.email(credentials);
            if (result.error) {
                setError(
                    result.error.message ??
                        "Please check your details and try again.",
                );
                setBusy(false);
            } else {
                // Reload server-rendered account data after the session changes.
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                window.location.assign("/");
            }
        } catch {
            setError("Couldn't connect. Please try again.");
            setBusy(false);
        }
    }

    return (
        <main className="mx-auto w-full max-w-sm px-4 py-8">
            <header className="mb-8">
                <Brand />
            </header>
            <h1 className="mb-6 text-2xl font-semibold">
                {creating ? "Create account" : "Sign in"}
            </h1>
            <Form onSubmit={submit} className="grid gap-5">
                {creating && (
                    <BaseField.Root name="name" render={<Field />}>
                        <BaseField.Label render={<FieldLabel />}>
                            Name
                        </BaseField.Label>
                        <Input
                            className="h-11"
                            autoComplete="name"
                            required
                            maxLength={80}
                        />
                        <BaseField.Error render={<FieldError />} />
                    </BaseField.Root>
                )}
                <BaseField.Root name="email" render={<Field />}>
                    <BaseField.Label render={<FieldLabel />}>
                        Email
                    </BaseField.Label>
                    <Input
                        className="h-11"
                        type="email"
                        autoComplete="email"
                        required
                        maxLength={254}
                    />
                    <BaseField.Error render={<FieldError />} />
                </BaseField.Root>
                <BaseField.Root name="password" render={<Field />}>
                    <BaseField.Label render={<FieldLabel />}>
                        Password
                    </BaseField.Label>
                    <Input
                        className="h-11"
                        type="password"
                        autoComplete={
                            creating ? "new-password" : "current-password"
                        }
                        minLength={creating ? 12 : undefined}
                        maxLength={128}
                        required
                    />
                    {creating && (
                        <BaseField.Description render={<FieldDescription />}>
                            At least 12 characters.
                        </BaseField.Description>
                    )}
                    <BaseField.Error render={<FieldError />} />
                </BaseField.Root>
                {error && <FieldError>{error}</FieldError>}
                <Button className="h-11" type="submit" disabled={busy}>
                    {busy
                        ? "Please wait..."
                        : creating
                          ? "Create account"
                          : "Sign in"}
                </Button>
            </Form>
            <Button
                type="button"
                variant="link"
                className="mt-3 h-11 px-0"
                disabled={busy}
                onClick={() => {
                    setCreating(!creating);
                    setError("");
                }}
            >
                {creating ? "Back to sign in" : "Create an account"}
            </Button>
        </main>
    );
}
