"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Select,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { useForm, type Path } from "react-hook-form";
import {
  CURRENCIES,
  acceptInviteSchema,
  activateFormSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  type AcceptInviteValues,
  type ActivateFormValues,
  type ChangePasswordValues,
  type ForgotPasswordValues,
  type LoginValues,
  type ResetPasswordValues,
} from "@/lib/validation/auth";
import {
  acceptInviteAction,
  activateAction,
  changePasswordAction,
  forgotPasswordAction,
  loginAction,
  logoutAction,
  resetPasswordAction,
  type ActionResult,
} from "@/server/actions/auth";

const useStyles = makeStyles({
  form: { display: "flex", flexDirection: "column", rowGap: tokens.spacingVerticalM },
});

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Mexico_City",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

/** Applies a server action's error to the form: flag the field, or show a banner. */
function useServerError<T extends Record<string, unknown>>(
  setError: (name: Path<T>, error: { message: string }) => void,
) {
  const [formError, setFormError] = useState<string | null>(null);
  const apply = (res: ActionResult | void) => {
    if (!res || res.ok) return;
    if (res.field) setError(res.field as Path<T>, { message: res.message });
    else setFormError(res.message);
  };
  return { formError, setFormError, apply };
}

function Banner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <MessageBar intent="error" role="alert">
      <MessageBarBody>{message}</MessageBarBody>
    </MessageBar>
  );
}

export function ActivateForm() {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ActivateFormValues>({
    resolver: zodResolver(activateFormSchema),
    defaultValues: {
      licenseKey: "",
      companyName: "",
      ownerName: "",
      ownerEmail: "",
      password: "",
      confirmPassword: "",
      timeZone: "UTC",
      currency: "USD",
    },
  });
  const { formError, setFormError, apply } = useServerError<ActivateFormValues>(setError);
  const [zones, setZones] = useState(TIME_ZONES);

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) {
      setZones((z) => (z.includes(detected) ? z : [detected, ...z]));
      setValue("timeZone", detected);
    }
  }, [setValue]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    apply(await activateAction(values));
  });

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Banner message={formError} />
      <Field
        label="License key"
        required
        validationMessage={errors.licenseKey?.message}
        hint="From your purchase email, like CRM-XXXXX-XXXXX-XXXXX-XXXXXX"
      >
        <Input {...register("licenseKey")} autoComplete="off" spellCheck={false} />
      </Field>
      <Field label="Company name" required validationMessage={errors.companyName?.message}>
        <Input {...register("companyName")} autoComplete="organization" />
      </Field>
      <Field label="Your full name" required validationMessage={errors.ownerName?.message}>
        <Input {...register("ownerName")} autoComplete="name" />
      </Field>
      <Field label="Your email" required validationMessage={errors.ownerEmail?.message}>
        <Input type="email" {...register("ownerEmail")} autoComplete="email" />
      </Field>
      <Field
        label="Password"
        required
        validationMessage={errors.password?.message}
        hint="At least 12 characters"
      >
        <Input type="password" {...register("password")} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" required validationMessage={errors.confirmPassword?.message}>
        <Input type="password" {...register("confirmPassword")} autoComplete="new-password" />
      </Field>
      <Field label="Time zone" validationMessage={errors.timeZone?.message}>
        <Select {...register("timeZone")}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Currency" validationMessage={errors.currency?.message}>
        <Select {...register("currency")}>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Setting up…" : "Set up my business"}
      </Button>
    </form>
  );
}

export function LoginForm({ next, reason }: { next?: string; reason?: string }) {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const { formError, setFormError, apply } = useServerError<LoginValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    apply(await loginAction(values, next));
  });

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      {reason === "license" ? (
        <Banner message="This license isn't active. Contact support." />
      ) : null}
      <Banner message={formError} />
      <Field label="Email" required validationMessage={errors.email?.message}>
        <Input type="email" {...register("email")} autoComplete="username" />
      </Field>
      <Field label="Password" required validationMessage={errors.password?.message}>
        <Input type="password" {...register("password")} autoComplete="current-password" />
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });
  const { formError, setFormError, apply } = useServerError<ChangePasswordValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    apply(await changePasswordAction(values));
  });

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Banner message={formError} />
      <Field label="Current password" required validationMessage={errors.currentPassword?.message}>
        <Input type="password" {...register("currentPassword")} autoComplete="current-password" />
      </Field>
      <Field
        label="New password"
        required
        validationMessage={errors.password?.message}
        hint="At least 12 characters"
      >
        <Input type="password" {...register("password")} autoComplete="new-password" />
      </Field>
      <Field
        label="Confirm new password"
        required
        validationMessage={errors.confirmPassword?.message}
      >
        <Input type="password" {...register("confirmPassword")} autoComplete="new-password" />
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

export function SignOutButton() {
  return (
    <form action={logoutAction}>
      <Button type="submit" appearance="subtle">
        Sign out
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { formError, setFormError, apply } = useServerError<ForgotPasswordValues>(setError);
  const [sent, setSent] = useState(false);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const res = await forgotPasswordAction(values);
    if (res.ok) setSent(true);
    else apply(res);
  });

  // Same message whether or not the address has an account.
  if (sent) {
    return (
      <MessageBar intent="success" role="status">
        <MessageBarBody>
          If an account exists for that address, we&apos;ve emailed a link to reset the password. It
          works once and expires in 30 minutes.
        </MessageBarBody>
      </MessageBar>
    );
  }
  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Banner message={formError} />
      <Field label="Email" required validationMessage={errors.email?.message}>
        <Input type="email" {...register("email")} autoComplete="username" />
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Email me a reset link"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });
  const { formError, setFormError, apply } = useServerError<ResetPasswordValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    apply(await resetPasswordAction(token, values));
  });

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Banner message={formError} />
      <Field
        label="New password"
        required
        validationMessage={errors.password?.message}
        hint="At least 12 characters"
      >
        <Input type="password" {...register("password")} autoComplete="new-password" />
      </Field>
      <Field
        label="Confirm new password"
        required
        validationMessage={errors.confirmPassword?.message}
      >
        <Input type="password" {...register("confirmPassword")} autoComplete="new-password" />
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}

export function AcceptInviteForm({ token }: { token: string }) {
  const styles = useStyles();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AcceptInviteValues>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { fullName: "", password: "", confirmPassword: "" },
  });
  const { formError, setFormError, apply } = useServerError<AcceptInviteValues>(setError);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    apply(await acceptInviteAction(token, values));
  });

  return (
    <form onSubmit={onSubmit} className={styles.form} noValidate>
      <Banner message={formError} />
      <Field label="Your full name" required validationMessage={errors.fullName?.message}>
        <Input {...register("fullName")} autoComplete="name" />
      </Field>
      <Field
        label="Password"
        required
        validationMessage={errors.password?.message}
        hint="At least 12 characters"
      >
        <Input type="password" {...register("password")} autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" required validationMessage={errors.confirmPassword?.message}>
        <Input type="password" {...register("confirmPassword")} autoComplete="new-password" />
      </Field>
      <Button appearance="primary" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Joining…" : "Join"}
      </Button>
    </form>
  );
}
