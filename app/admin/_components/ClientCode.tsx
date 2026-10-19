/** Customer-facing account ID (e.g. "RAHUL-4821"), shown next to the phone. Renders nothing for legacy leads. */
export function ClientCode({ code, large = false }: { code: string | null | undefined; large?: boolean }) {
  if (!code) return null;
  return (
    <span className={large ? "adm-client-code adm-client-code-lg" : "adm-client-code"} title="Client ID">
      <span className="adm-sr">Client ID </span>
      {code}
    </span>
  );
}
