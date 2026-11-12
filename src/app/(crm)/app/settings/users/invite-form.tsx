"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
} from "@fluentui/react-components";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { inviteUserSchema, type InviteUserValues } from "@/lib/validation/auth";
import { inviteUserAction } from "@/server/actions/users";

export function InviteForm({ roles }: { roles: { id: string; name: string }[] }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InviteUserValues>({
    resolver: zodResolver(inviteUserSchema),
    defaultValues: { email: "", roleId: roles.find((r) => r.name === "Salesperson")?.id ?? "" },
  });
  const [banner, setBanner] = useState<{ intent: "error" | "success"; text: string } | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setBanner(null);
    const res = await inviteUserAction(values);
    if (res.ok) {
      setBanner({ intent: "success", text: `Invitation sent to ${values.email}.` });
      reset({ email: "", roleId: values.roleId });
    } else {
      // Server-side refusals (seat limit, unavailable address, no permission) are shown once,
      // as a banner. Field-level messages are reserved for client-side validation, so a screen
      // reader doesn't announce the same error twice.
      setBanner({ intent: "error", text: res.message });
    }
  });

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 420 }}
    >
      {banner ? (
        <MessageBar intent={banner.intent} role={banner.intent === "error" ? "alert" : "status"}>
          <MessageBarBody>{banner.text}</MessageBarBody>
        </MessageBar>
      ) : null}
      <Field label="Email to invite" required validationMessage={errors.email?.message}>
        <Input type="email" {...register("email")} autoComplete="off" />
      </Field>
      <Field label="Role" required validationMessage={errors.roleId?.message}>
        <Select {...register("roleId")}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Send invitation"}
      </Button>
    </form>
  );
}
