"use client";

export function DeleteButton({
  action,
  name,
}: {
  action: () => void | Promise<void>;
  name: string;
}) {
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`„${name}“ wirklich löschen?`)) e.preventDefault();
      }}
    >
      <button type="submit" className="btn btn--danger">
        Löschen
      </button>
    </form>
  );
}
