import { ActionForm } from "./forms";
import { Field } from "./ui";
import { changePasswordAction } from "@/lib/actions/session";

export default function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} submit="Change password" resetOnOk>
      <div className="space-y-4">
        <Field label="Current password"><input className="input" type="password" name="current_password" autoComplete="current-password" required /></Field>
        <Field label="New password" hint="At least 10 characters, with letters and a number."><input className="input" type="password" name="new_password" autoComplete="new-password" minLength={10} required /></Field>
      </div>
    </ActionForm>
  );
}
