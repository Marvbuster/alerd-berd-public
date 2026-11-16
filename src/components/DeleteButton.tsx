"use client";

import { translate as _t } from "@/i18n/translate";
import { useLocale as _useLocale } from "next-intl";

export function DeleteButton({
  action,
  name,
}: {
  action: () => void | Promise<void>;
  name: string;
}) {
  const _locale = _useLocale();
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(_t(_locale, "DeleteButton.mcc16bf56a1", { value0: name }))) e.preventDefault();
      }}
    >
      <button type="submit" className="btn btn--danger">
        {_t(_locale, "DeleteButton.m6c2d352161")}</button>
    </form>
  );
}
